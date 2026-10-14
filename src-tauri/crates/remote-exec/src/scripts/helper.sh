#!/bin/sh
# ORGII remote run helper (protocol v1). POSIX sh only: the remote host may
# run dash, bash-as-sh, busybox ash or BSD sh, with GNU or BSD userland.
#
# A "run" is one detached CLI process whose output is appended to log files,
# so the desktop can disconnect, reconnect and resume from a byte offset.
#
#   ~/.orgii/remote/runs/<run_id>/
#     cmd.sh          generated command (removes itself once started)
#     stdin           FIFO, only in pipe mode
#     stdout.log      append-only child stdout
#     stderr.log      append-only child stderr
#     pid             child pid
#     supervisor.pid  supervisor pid (its process group is the kill target)
#     holder.pid      process that keeps the stdin FIFO open between writers
#     stdin.ready     both ends of the FIFO are held; writes are safe
#     in.<seq>.done   stdin message <seq> was delivered (dedupe marker)
#     stdin.eof       the desktop closed stdin on purpose
#     exit            child exit code, written atomically after it exits
#
# Modes: supervise | attach | write | ctl. Replies are lines starting with
# "ORGII-" so rc-file noise on stdout can be skipped by the reader.

set -u
umask 077

say() { printf '%s\n' "$*"; }

is_uint() {
    case "${1:-}" in
        '' | *[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

mode="${1:-}"
run_id="${2:-}"
case "$run_id" in
    '' | *[!A-Za-z0-9_-]*)
        say "ORGII-ERR bad-run-id"
        exit 64
        ;;
esac
base="$HOME/.orgii/remote"
run_dir="$base/runs/$run_id"

# Fractional sleep is not POSIX but every mainstream userland has it. The
# *_ds values are the same naps in tenths of a second, for bookkeeping.
probe_sleep() {
    if sleep 0.1 2>/dev/null; then
        fast=0.1
        fast_ds=1
        slow=0.5
        slow_ds=5
    else
        fast=1
        fast_ds=10
        slow=1
        slow_ds=10
    fi
}

# Non-interactive ssh sessions get a minimal PATH, so CLIs installed through
# nvm, ~/.local/bin and friends are not found. Ask the login shell once, with
# a hard timeout because interactive rc files can block without a tty.
login_path() {
    lp_shell="${SHELL:-}"
    [ -n "$lp_shell" ] && [ -x "$lp_shell" ] || return 0
    "$lp_shell" -l -i -c 'printf "\n__ORGII_PATH__%s__ORGII_END__\n" "$PATH"' \
        </dev/null >./login-path.out 2>/dev/null &
    lp_pid=$!
    lp_waited=0
    while kill -0 "$lp_pid" 2>/dev/null && [ "$lp_waited" -lt 50 ]; do
        sleep "$fast"
        lp_waited=$((lp_waited + fast_ds))
    done
    kill -9 "$lp_pid" 2>/dev/null
    wait "$lp_pid" 2>/dev/null
    lp_value=$(sed -n 's/^__ORGII_PATH__\(.*\)__ORGII_END__$/\1/p' ./login-path.out 2>/dev/null | tail -n 1)
    rm -f ./login-path.out
    if [ -n "$lp_value" ]; then
        PATH="$lp_value"
        export PATH
    fi
    return 0
}

kill_tree() {
    for kt_child in $(pgrep -P "$1" 2>/dev/null); do
        kill_tree "$kt_child" "$2"
    done
    kill "-$2" "$1" 2>/dev/null
    return 0
}

# emit <tag> <file> <offset>: send the bytes past <offset> as one frame and
# leave the frame length in $emit_len. Frames are capped so the reader never
# has to buffer more than max_frame bytes.
emit() {
    emit_len=0
    e_size=$(wc -c <"$2" 2>/dev/null)
    e_size=${e_size##* }
    e_size=${e_size:-0}
    [ "$e_size" -gt "$3" ] || return 0
    emit_len=$((e_size - $3))
    [ "$emit_len" -le "$max_frame" ] || emit_len=$max_frame
    printf '%s %d\n' "$1" "$emit_len" || exit 0
    tail -c "+$(($3 + 1))" "$2" | head -c "$emit_len" || exit 0
}

case "$mode" in
supervise)
    stdin_mode="${3:-null}"
    want_login_path="${4:-1}"
    cd "$run_dir" || exit 66
    probe_sleep
    say "$$" >./supervisor.pid
    # A handler, not an ignore: ignored signals are inherited by the child,
    # a handler is reset on exec. The supervisor must outlive a group TERM so
    # it can record the exit code.
    trap ':' TERM INT HUP
    [ "$want_login_path" = 1 ] && login_path

    holder=""
    if [ "$stdin_mode" = pipe ]; then
        # Keeps a write end open so the child only sees EOF when the desktop
        # asks for it, not whenever a writer or a connection goes away.
        # Opening for write blocks until the child has opened for read, so the
        # marker means both ends are held: bytes written from then on stay in
        # the pipe instead of vanishing when a transient writer closes.
        (
            exec 3>./stdin
            : >./stdin.ready
            while [ ! -e ./stdin.eof ] && [ ! -e ./exit ]; do sleep 1; done
        ) &
        holder=$!
        say "$holder" >./holder.pid
        sh ./cmd.sh <./stdin >>./stdout.log 2>>./stderr.log &
    else
        sh ./cmd.sh </dev/null >>./stdout.log 2>>./stderr.log &
    fi
    child=$!
    say "$child" >./pid

    # A trapped signal interrupts `wait` with the child still running; keep
    # waiting until it is really gone so the recorded code is the real one.
    while :; do
        wait "$child"
        code=$?
        kill -0 "$child" 2>/dev/null || break
    done

    say "$code" >./exit.tmp && mv -f ./exit.tmp ./exit
    [ -n "$holder" ] && kill "$holder" 2>/dev/null
    exit 0
    ;;

attach)
    out="${3:-0}"
    err="${4:-0}"
    if ! is_uint "$out" || ! is_uint "$err"; then
        say "ORGII-ERR bad-offset"
        exit 64
    fi
    cd "$run_dir" 2>/dev/null || {
        say "ORGII-ERR no-such-run"
        exit 66
    }
    probe_sleep
    max_frame=1048576
    say "ORGII-ATTACH 1" || exit 0
    idle_ds=0
    beat_ds=0
    seen_exit=0
    while :; do
        # Read the exit marker before the sizes: it is written after the
        # child's last byte, so sizes read afterwards are final.
        [ -f ./exit ] && seen_exit=1
        emit O ./stdout.log "$out"
        out=$((out + emit_len))
        moved=$emit_len
        emit E ./stderr.log "$err"
        err=$((err + emit_len))
        moved=$((moved + emit_len))
        if [ "$moved" -gt 0 ]; then
            idle_ds=0
            beat_ds=0
            continue
        fi
        if [ "$seen_exit" -eq 1 ]; then
            code=$(cat ./exit 2>/dev/null)
            is_uint "$code" || code=1
            say "X $code"
            exit 0
        fi
        if [ "$idle_ds" -lt 30 ]; then
            nap=$fast
            nap_ds=$fast_ds
        else
            nap=$slow
            nap_ds=$slow_ds
        fi
        sleep "$nap"
        idle_ds=$((idle_ds + nap_ds))
        beat_ds=$((beat_ds + nap_ds))
        # The keepalive doubles as dead-peer detection on this side: once the
        # connection is gone the write fails and this loop stops polling.
        if [ "$beat_ds" -ge 50 ]; then
            say K || exit 0
            beat_ds=0
        fi
    done
    ;;

write)
    seq="${3:-}"
    len="${4:-}"
    if ! is_uint "$seq" || ! is_uint "$len"; then
        say "ORGII-ERR bad-args"
        exit 64
    fi
    cd "$run_dir" 2>/dev/null || {
        say "ORGII-ERR no-such-run"
        exit 66
    }
    [ -p ./stdin ] || {
        say "ORGII-ERR no-stdin"
        exit 65
    }
    # A retry of a message that already landed: acknowledge, never redeliver.
    if [ -e "./in.$seq.done" ]; then
        cat >/dev/null
        say "ORGII-OK"
        exit 0
    fi
    # Stage the whole message first. A dropped connection looks like EOF, so
    # only a length match proves it arrived intact; delivery into the FIFO is
    # then a purely local step the connection can no longer interrupt.
    cat >"./in.$seq.tmp"
    got=$(wc -c <"./in.$seq.tmp")
    got=${got##* }
    if [ "${got:-0}" -ne "$len" ]; then
        rm -f "./in.$seq.tmp"
        say "ORGII-ERR short-write"
        exit 74
    fi
    # The first message can beat the supervisor to the FIFO (it may still be
    # asking the login shell for PATH). Writing before both ends are held
    # would drop the message silently.
    if [ ! -e ./stdin.ready ]; then
        probe_sleep
        waited=0
        while [ ! -e ./stdin.ready ] && [ ! -e ./exit ] && [ "$waited" -lt 100 ]; do
            sleep "$fast"
            waited=$((waited + fast_ds))
        done
    fi
    if [ -e ./exit ]; then
        rm -f "./in.$seq.tmp"
        say "ORGII-ERR exited"
        exit 69
    fi
    if [ ! -e ./stdin.ready ]; then
        rm -f "./in.$seq.tmp"
        say "ORGII-ERR not-ready"
        exit 75
    fi
    # Read-write open never blocks waiting for a reader.
    if cat "./in.$seq.tmp" 1<>./stdin; then
        : >"./in.$seq.done"
        rm -f "./in.$seq.tmp"
        say "ORGII-OK"
        exit 0
    fi
    rm -f "./in.$seq.tmp"
    say "ORGII-ERR fifo-write"
    exit 74
    ;;

ctl)
    action="${3:-}"
    cd "$run_dir" 2>/dev/null || {
        say "ORGII-ERR no-such-run"
        exit 66
    }
    case "$action" in
    close-stdin)
        : >./stdin.eof
        [ -f ./holder.pid ] && kill "$(cat ./holder.pid)" 2>/dev/null
        say "ORGII-OK"
        ;;
    kill)
        sig="${4:-TERM}"
        case "$sig" in
            TERM | KILL | INT) ;;
            *)
                say "ORGII-ERR bad-signal"
                exit 64
                ;;
        esac
        if [ -e ./exit ]; then
            say "ORGII-OK already-exited"
            exit 0
        fi
        spid=$(cat ./supervisor.pid 2>/dev/null)
        cpid=$(cat ./pid 2>/dev/null)
        target_pg=""
        if is_uint "$spid"; then
            target_pg=$(ps -o pgid= -p "$spid" 2>/dev/null | tr -d ' ')
        fi
        own_pg=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')
        # The supervisor's group holds only this run. Never signal a group
        # that also contains this control process: that would mean the server
        # did not isolate sessions, so fall back to walking the tree.
        if is_uint "$target_pg" && [ "$target_pg" -gt 1 ] && [ "$target_pg" != "$own_pg" ]; then
            kill "-$sig" -- "-$target_pg" 2>/dev/null
        elif is_uint "$cpid"; then
            kill_tree "$cpid" "$sig"
        fi
        if [ "$sig" = KILL ]; then
            # A group KILL takes the supervisor down too, so nobody is left to
            # record the exit code.
            probe_sleep
            waited=0
            while [ ! -e ./exit ] && [ "$waited" -lt 20 ]; do
                sleep "$fast"
                waited=$((waited + fast_ds))
            done
            if [ ! -e ./exit ]; then
                say 137 >./exit.tmp && mv -f ./exit.tmp ./exit
            fi
        fi
        say "ORGII-OK"
        ;;
    status)
        if [ -e ./exit ]; then
            say "ORGII-OK exited $(cat ./exit 2>/dev/null)"
        else
            say "ORGII-OK running"
        fi
        ;;
    cleanup)
        if [ ! -e ./exit ]; then
            say "ORGII-ERR still-running"
            exit 75
        fi
        cd "$base" && rm -rf "./runs/$run_id"
        say "ORGII-OK"
        ;;
    *)
        say "ORGII-ERR bad-action"
        exit 64
        ;;
    esac
    ;;

*)
    say "ORGII-ERR bad-mode"
    exit 64
    ;;
esac
