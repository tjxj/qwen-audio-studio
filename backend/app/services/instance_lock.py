"""Own a data directory for the entire application lifetime."""
import fcntl
import os
from pathlib import Path


class InstanceAlreadyRunning(RuntimeError):
    code = 'INSTANCE_ALREADY_RUNNING'


class InstanceLock:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.fd = None
        fd = os.open(root / 'instance.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(fd)
            raise InstanceAlreadyRunning('已有应用正在使用这个数据目录，请先关闭原服务。') from exc
        except BaseException:
            os.close(fd)
            raise
        self.fd = fd

    def release(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
