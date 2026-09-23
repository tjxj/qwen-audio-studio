from __future__ import annotations

import getpass
import ctypes
from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel


API_KEY_SERVICE = "QwenAudioStudio.DashScopeAPIKey"
WORKSPACE_SERVICE = "QwenAudioStudio.WorkspaceID"


@dataclass(frozen=True)
class Credentials:
    api_key: str
    workspace_id: str


class CredentialStatus(BaseModel):
    api_key_configured: bool
    workspace_configured: bool


class KeychainWriteError(RuntimeError):
    code = "KEYCHAIN_UNAVAILABLE"


class KeychainRollbackError(KeychainWriteError):
    pass


class CredentialStore:
    def status(self) -> CredentialStatus:
        raise NotImplementedError

    def set(self, credentials: Credentials) -> None:
        raise NotImplementedError

    def get(self) -> Credentials:
        raise NotImplementedError

    def clear(self) -> None:
        raise NotImplementedError

    def snapshot(self) -> Credentials:
        """Partial read that never raises, so a merge can be computed safely."""
        raise NotImplementedError

    def replace(self, credentials: Credentials) -> None:
        """Write both fields, deleting the ones left empty."""
        raise NotImplementedError

    def update(
        self,
        *,
        api_key: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> Credentials:
        """Merge single-field edits and undo them if the second write fails."""
        previous = self.snapshot()
        merged = Credentials(
            api_key=(previous.api_key if api_key is None else api_key).strip(),
            workspace_id=(
                previous.workspace_id if workspace_id is None else workspace_id
            ).strip(),
        )
        try:
            self.replace(merged)
        except Exception as exc:
            try:
                self.replace(previous)
            except Exception as rollback_exc:  # pragma: no cover - keychain is wedged
                raise KeychainRollbackError(
                    "凭据写入失败，且旧值无法自动恢复；请解锁钥匙串后重新填写。"
                ) from rollback_exc
            raise KeychainWriteError(
                "凭据未能完整保存，已恢复为原来的值。"
            ) from exc
        return merged

    def clear_field(self, scope: str) -> None:
        current = self.snapshot()
        updates: dict[str, Optional[str]] = {}
        if scope in {"all", "api_key"}:
            updates["api_key"] = ""
        if scope in {"all", "workspace_id"}:
            updates["workspace_id"] = ""
        if not updates:
            raise ValueError("Unknown credential scope")
        self.update(**updates)


class FakeCredentialStore(CredentialStore):
    """In-memory stand-in that can fail a single field write on demand."""

    def __init__(
        self,
        credentials: Optional[Credentials] = None,
        fail_on_write: Optional[set[int]] = None,
    ):
        self.credentials = credentials
        self.fail_on_write = set(fail_on_write or ())
        self.write_count = 0

    def status(self) -> CredentialStatus:
        return CredentialStatus(
            api_key_configured=bool(
                self.credentials and self.credentials.api_key
            ),
            workspace_configured=bool(
                self.credentials and self.credentials.workspace_id
            ),
        )

    def set(self, credentials: Credentials) -> None:
        self.replace(credentials)

    def snapshot(self) -> Credentials:
        return self.credentials or Credentials(api_key="", workspace_id="")

    def replace(self, credentials: Credentials) -> None:
        self._apply("api_key", credentials.api_key)
        self._apply("workspace_id", credentials.workspace_id)

    def _apply(self, field: str, value: str) -> None:
        self.write_count += 1
        if self.write_count in self.fail_on_write:
            raise RuntimeError("simulated keychain failure")
        base = self.snapshot()
        merged = Credentials(
            api_key=value if field == "api_key" else base.api_key,
            workspace_id=value if field == "workspace_id" else base.workspace_id,
        )
        self.credentials = (
            merged if merged.api_key or merged.workspace_id else None
        )

    def get(self) -> Credentials:
        if not self.credentials:
            raise RuntimeError("Credentials are not configured")
        return self.credentials

    def clear(self) -> None:
        self.credentials = None


class MacOSKeychainBackend:
    """Small Security.framework wrapper that keeps secret bytes out of argv."""

    ITEM_NOT_FOUND = -25300
    DUPLICATE_ITEM = -25299

    def __init__(self):
        self.security = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/Security.framework/Security"
        )
        self.core_foundation = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        self._configure_functions()

    def _configure_functions(self) -> None:
        uint32 = ctypes.c_uint32
        void_p = ctypes.c_void_p
        char_p = ctypes.c_char_p
        self.security.SecKeychainFindGenericPassword.argtypes = [
            void_p, uint32, char_p, uint32, char_p,
            ctypes.POINTER(uint32), ctypes.POINTER(void_p), ctypes.POINTER(void_p),
        ]
        self.security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
        self.security.SecKeychainAddGenericPassword.argtypes = [
            void_p, uint32, char_p, uint32, char_p, uint32, void_p,
            ctypes.POINTER(void_p),
        ]
        self.security.SecKeychainAddGenericPassword.restype = ctypes.c_int32
        self.security.SecKeychainItemModifyAttributesAndData.argtypes = [
            void_p, void_p, uint32, void_p,
        ]
        self.security.SecKeychainItemModifyAttributesAndData.restype = ctypes.c_int32
        self.security.SecKeychainItemDelete.argtypes = [void_p]
        self.security.SecKeychainItemDelete.restype = ctypes.c_int32
        self.security.SecKeychainItemFreeContent.argtypes = [void_p, void_p]
        self.security.SecKeychainItemFreeContent.restype = ctypes.c_int32
        self.core_foundation.CFRelease.argtypes = [void_p]
        self.core_foundation.CFRelease.restype = None

    @staticmethod
    def _bytes(value: str) -> bytes:
        return value.encode("utf-8")

    def _find(self, service: str, account: str):
        service_bytes = self._bytes(service)
        account_bytes = self._bytes(account)
        password_length = ctypes.c_uint32()
        password_data = ctypes.c_void_p()
        item_ref = ctypes.c_void_p()
        status = self.security.SecKeychainFindGenericPassword(
            None,
            len(service_bytes),
            service_bytes,
            len(account_bytes),
            account_bytes,
            ctypes.byref(password_length),
            ctypes.byref(password_data),
            ctypes.byref(item_ref),
        )
        return status, password_length, password_data, item_ref

    def read(self, service: str, account: str) -> str:
        status, length, data, item = self._find(service, account)
        if status == self.ITEM_NOT_FOUND:
            return ""
        if status != 0:
            raise RuntimeError("Unable to read credentials from macOS Keychain")
        try:
            return ctypes.string_at(data, length.value).decode("utf-8")
        finally:
            self.security.SecKeychainItemFreeContent(None, data)
            if item:
                self.core_foundation.CFRelease(item)

    def write(self, service: str, account: str, value: str) -> None:
        service_bytes = self._bytes(service)
        account_bytes = self._bytes(account)
        value_bytes = self._bytes(value)
        item_ref = ctypes.c_void_p()
        status = self.security.SecKeychainAddGenericPassword(
            None,
            len(service_bytes),
            service_bytes,
            len(account_bytes),
            account_bytes,
            len(value_bytes),
            ctypes.c_char_p(value_bytes),
            ctypes.byref(item_ref),
        )
        if status == self.DUPLICATE_ITEM:
            find_status, _, data, item_ref = self._find(service, account)
            if find_status != 0:
                raise RuntimeError("Unable to update credentials in macOS Keychain")
            try:
                self.security.SecKeychainItemFreeContent(None, data)
                status = self.security.SecKeychainItemModifyAttributesAndData(
                    item_ref,
                    None,
                    len(value_bytes),
                    ctypes.c_char_p(value_bytes),
                )
            finally:
                if item_ref:
                    self.core_foundation.CFRelease(item_ref)
        elif item_ref:
            self.core_foundation.CFRelease(item_ref)
        if status != 0:
            raise RuntimeError(
                f"Unable to store credentials in macOS Keychain (OSStatus {status})"
            )

    def delete(self, service: str, account: str) -> None:
        status, _, data, item = self._find(service, account)
        if status == self.ITEM_NOT_FOUND:
            return
        if status != 0:
            raise RuntimeError("Unable to access credentials in macOS Keychain")
        try:
            self.security.SecKeychainItemFreeContent(None, data)
            status = self.security.SecKeychainItemDelete(item)
            if status != 0:
                raise RuntimeError("Unable to clear credentials from macOS Keychain")
        finally:
            if item:
                self.core_foundation.CFRelease(item)


class SystemKeychainStore(CredentialStore):
    def __init__(
        self,
        backend=None,
        account: Optional[str] = None,
    ):
        self.backend = backend or MacOSKeychainBackend()
        self.account = account or getpass.getuser()

    def _read(self, service: str) -> str:
        return self.backend.read(service, self.account)

    def _write(self, service: str, value: str) -> None:
        self.backend.write(service, self.account, value)

    def status(self) -> CredentialStatus:
        return CredentialStatus(
            api_key_configured=bool(self._read(API_KEY_SERVICE)),
            workspace_configured=bool(self._read(WORKSPACE_SERVICE)),
        )

    def set(self, credentials: Credentials) -> None:
        self._write(API_KEY_SERVICE, credentials.api_key)
        self._write(WORKSPACE_SERVICE, credentials.workspace_id)

    def snapshot(self) -> Credentials:
        return Credentials(
            api_key=self._read(API_KEY_SERVICE),
            workspace_id=self._read(WORKSPACE_SERVICE),
        )

    def replace(self, credentials: Credentials) -> None:
        for service, value in (
            (API_KEY_SERVICE, credentials.api_key),
            (WORKSPACE_SERVICE, credentials.workspace_id),
        ):
            if value:
                self._write(service, value)
            else:
                self.backend.delete(service, self.account)

    def get(self) -> Credentials:
        credentials = self.snapshot()
        if not credentials.api_key or not credentials.workspace_id:
            raise RuntimeError("Credentials are not configured")
        return credentials

    def clear(self) -> None:
        for service in (API_KEY_SERVICE, WORKSPACE_SERVICE):
            self.backend.delete(service, self.account)
