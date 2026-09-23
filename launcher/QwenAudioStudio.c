#include <mach-o/dyld.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int parent_directory(char *path) {
    char *slash = strrchr(path, '/');
    if (slash == NULL) return -1;
    *slash = '\0';
    return 0;
}

int main(void) {
    char executable[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0) return 1;

    char resolved[PATH_MAX];
    if (realpath(executable, resolved) == NULL) return 1;
    for (int level = 0; level < 4; level++) {
        if (parent_directory(resolved) != 0) return 1;
    }

    const char *suffix = "/启动 Qwen Audio Studio.command";
    if (strlen(resolved) + strlen(suffix) + 1 >= sizeof(resolved)) return 1;
    strcat(resolved, suffix);
    if (access(resolved, X_OK) != 0) return 1;

    pid_t child = fork();
    if (child < 0) return 1;
    if (child > 0) return 0;

    if (setsid() < 0) _exit(1);
    int null_fd = open("/dev/null", O_RDWR);
    if (null_fd >= 0) {
        dup2(null_fd, STDIN_FILENO);
        dup2(null_fd, STDOUT_FILENO);
        dup2(null_fd, STDERR_FILENO);
        if (null_fd > STDERR_FILENO) close(null_fd);
    }
    execl("/bin/bash", "bash", resolved, (char *)NULL);
    _exit(1);
}
