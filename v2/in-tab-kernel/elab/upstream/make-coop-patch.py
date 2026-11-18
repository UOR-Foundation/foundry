"""Writes the one runtime change the elaborator needs on a page without threads, then `git diff` records it.

Lean 4.32.2's frontend uses promises, and `IO.Promise.new` panics when there is no task manager, so the build keeps
the task manager (LEAN_MULTI_THREAD) and, under LEAN_COOP_TASKS, never starts a thread: a waiter runs queued tasks
itself until the task it waits for has a value. A wait that nothing queued can satisfy is a panic, never a hang.
Usage: python3 make-coop-patch.py path/to/lean4/src/runtime/object.cpp
"""
import sys

path = sys.argv[1]
text = open(path).read()


def swap(old, new):
    global text
    assert text.count(old) == 1, old[:60]
    text = text.replace(old, new)


swap("""    void spawn_worker() {
        if (m_shutting_down)
            return;
""", """    void spawn_worker() {
#ifdef LEAN_COOP_TASKS
        return;  // no threads: waiters run queued tasks themselves
#endif
        if (m_shutting_down)
            return;
""")

swap("""    void spawn_dedicated_worker(lean_task_object * t) {
""", """    void spawn_dedicated_worker(lean_task_object * t) {
#ifdef LEAN_COOP_TASKS
        m_queues[LEAN_MAX_PRIO].push_back(t);
        m_queues_size++;
        if (LEAN_MAX_PRIO > m_max_prio) m_max_prio = LEAN_MAX_PRIO;
        return;
#endif
""")

swap("""        // see `Task.get`
        bool in_pool""", """#ifdef LEAN_COOP_TASKS
        while (!t->m_value) {
            if (m_queues_size == 0)
                lean_internal_panic("single-threaded: Task.get on a task that no queued task can finish");
            run_task(lock, dequeue());
        }
        return;
#endif
        // see `Task.get`
        bool in_pool""")

swap("""        while (true) {
            if (object * t = wait_any_check(task_list))
                return t;
            m_task_finished_cv.wait(lock);
        }""", """        while (true) {
            if (object * t = wait_any_check(task_list))
                return t;
#ifdef LEAN_COOP_TASKS
            if (m_queues_size == 0)
                lean_internal_panic("single-threaded: IO.waitAny on tasks that no queued task can finish");
            run_task(lock, dequeue());
            continue;
#endif
            m_task_finished_cv.wait(lock);
        }""")

open(path, "w").write(text)

# `main` runs on the calling thread; its stack is the link's STACK_SIZE, not a thread's.
thread = path.replace("object.cpp", "thread.cpp")
t = open(thread).read()
old = "#ifdef LEAN_MULTI_THREAD\n    const char * stack_size_env"
assert t.count(old) == 1
open(thread, "w").write(t.replace(old, "#if defined(LEAN_MULTI_THREAD) && !defined(LEAN_COOP_TASKS)\n    const char * stack_size_env"))
