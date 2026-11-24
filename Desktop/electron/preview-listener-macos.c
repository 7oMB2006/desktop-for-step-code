#include <inttypes.h>
#include <libproc.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/proc_info.h>

static int parse_pid(const char *text) {
    char *end;
    long value = strtol(text, &end, 10);
    return *text && !*end && value > 0 && value <= INT_MAX ? (int)value : 0;
}

int main(int argc, char **argv) {
    if (argc < 3 || argc > 130) return EXIT_FAILURE;
    int root = parse_pid(argv[1]);
    if (!root) return EXIT_FAILURE;
    for (int index = 2; index < argc; ++index) {
        int pid = parse_pid(argv[index]);
        int reached_root = 0;
        for (int depth = 0; pid > 0 && depth < 64; ++depth) {
            struct proc_bsdinfo info;
            if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)
                || info.pbi_pid != (uint32_t)pid || !info.pbi_start_tvsec) return EXIT_FAILURE;
            uint64_t start = info.pbi_start_tvsec * UINT64_C(1000000) + info.pbi_start_tvusec;
            printf("%u %u %" PRIu64 "\n", info.pbi_pid, info.pbi_ppid, start);
            if (pid == root) { reached_root = 1; break; }
            if (!info.pbi_ppid || info.pbi_ppid > INT_MAX || info.pbi_ppid == info.pbi_pid) break;
            pid = (int)info.pbi_ppid;
        }
        if (!reached_root) return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
