use rusqlite::Connection;

use super::store_write::{active_episode_task_counts, exact_member_turn_task_id};

#[test]
fn final_member_exit_counts_the_active_episode_across_resume_generations() {
    let conn = Connection::open_in_memory().expect("in-memory database");
    conn.execute_batch(
        "CREATE TABLE agent_org_execution_tasks(
             id TEXT NOT NULL,org_run_id TEXT NOT NULL,activation_generation INTEGER NOT NULL,
             status TEXT NOT NULL,PRIMARY KEY(org_run_id,id)
         );
         CREATE TABLE agent_org_execution_work_episodes(
             id TEXT PRIMARY KEY,org_run_id TEXT NOT NULL,status TEXT NOT NULL
         );
         CREATE TABLE agent_org_execution_work_episode_tasks(
             org_run_id TEXT NOT NULL,work_episode_id TEXT NOT NULL,task_id TEXT NOT NULL
         );
         INSERT INTO agent_org_execution_work_episodes VALUES
             ('episode-active','run','active'),('episode-old','run','certified');
         INSERT INTO agent_org_execution_tasks VALUES
             ('task-one','run',2,'completed'),
             ('task-two','run',2,'completed'),
             ('task-old','run',1,'pending');
         INSERT INTO agent_org_execution_work_episode_tasks VALUES
             ('run','episode-active','task-one'),
             ('run','episode-active','task-two'),
             ('run','episode-old','task-old');",
    )
    .expect("episode fixture");

    assert_eq!(
        active_episode_task_counts(&conn, "run").expect("active episode counts"),
        (2, 0),
        "the current execution generation must not hide tasks created before Pause/Resume"
    );
}

#[test]
fn member_idle_keeps_the_exact_producing_turn_instead_of_guessing_latest() {
    let conn = Connection::open_in_memory().expect("in-memory database");
    conn.execute_batch(
        "CREATE TABLE agent_org_execution_turn_contexts(
             context_id INTEGER PRIMARY KEY AUTOINCREMENT,
             org_run_id TEXT NOT NULL,participant_id TEXT NOT NULL,
             turn_kind TEXT NOT NULL,turn_intent_id TEXT NOT NULL,task_id TEXT
         );
         INSERT INTO agent_org_execution_turn_contexts
             (org_run_id,participant_id,turn_kind,turn_intent_id,task_id) VALUES
             ('run','member','task_execution','turn-before-pause','task-one'),
             ('run','member','task_execution','turn-after-resume','task-two');",
    )
    .expect("turn fixture");

    assert_eq!(
        exact_member_turn_task_id(&conn, "run", "member", "turn-before-pause")
            .expect("exact source lookup"),
        Some("task-one".to_string())
    );
    assert_eq!(
        exact_member_turn_task_id(&conn, "run", "member", "missing-turn")
            .expect("missing source is not guessed"),
        None
    );
}
