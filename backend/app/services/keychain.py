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


class CredentialStore:
    def status(self) -> CredentialStatus:
        raise NotImplementedError

    def set(self, credentials: Credentials) -> None:
        raise NotImplementedError

    def get(self) -> Credentials:
        raise NotImplementedError

    def clear(self) -> None:
        raise NotImplementedError


class FakeCredentialStore(CredentialStore):
    def __init__(self, credentials: Optional[Credentials] = None):
        self.credentials = credentials

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
        self.credentials = credentials

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

    def get(self) -> Credentials:
        credentials = Credentials(
            api_key=self._read(API_KEY_SERVICE),
            workspace_id=self._read(WORKSPACE_SERVICE),
        )
        if not credentials.api_key or not credentials.workspace_id:
            raise RuntimeError("Credentials are not configured")
        return credentials

    def clear(self) -> None:
        for service in (API_KEY_SERVICE, WORKSPACE_SERVICE):
            self.backend.delete(service, self.account)
