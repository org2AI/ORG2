use super::store::*;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    init(&c).unwrap();
    c
}
fn create(c: &mut Connection, name: &str) -> String {
    mutate(
        c,
        Mutation::Create {
            name: name.into(),
            session_id: None,
        },
    )
    .unwrap()
    .sections
    .last()
    .unwrap()
    .id
    .clone()
}
#[test]
fn membership_is_unique_and_delete_preserves_other_sections() {
    let mut c = db();
    let a = create(&mut c, " A ");
    let b = create(&mut c, "B");
    for id in [&a, &b] {
        mutate(
            &mut c,
            Mutation::Assign {
                session_id: "old-session".into(),
                section_id: Some(id.clone()),
            },
        )
        .unwrap();
    }
    let s = snapshot(&c).unwrap();
    assert_eq!(s.sections[0].name, "A");
    assert_eq!(s.members.len(), 1);
    assert_eq!(s.members[0].section_id, b);
    mutate(&mut c, Mutation::Delete { id: b }).unwrap();
    assert!(snapshot(&c).unwrap().members.is_empty());
    assert_eq!(snapshot(&c).unwrap().sections[0].id, a);
}
#[test]
fn rejects_invalid_writes_without_partial_changes() {
    let mut c = db();
    let a = create(&mut c, "A");
    for invalid in ["", "   ", "a\nb"] {
        assert!(mutate(
            &mut c,
            Mutation::Create {
                name: invalid.into(),
                session_id: None
            }
        )
        .is_err());
    }
    assert!(mutate(
        &mut c,
        Mutation::Assign {
            session_id: "x".into(),
            section_id: Some("missing".into())
        }
    )
    .is_err());
    assert!(mutate(
        &mut c,
        Mutation::Reorder {
            ids: vec![a.clone(), a.clone()]
        }
    )
    .is_err());
    assert!(mutate(&mut c, Mutation::Reorder { ids: vec![] }).is_err());
    assert_eq!(snapshot(&c).unwrap().sections.len(), 1);
    assert!(snapshot(&c).unwrap().members.is_empty());
}
#[test]
fn pagination_and_reinitialization_keep_older_members() {
    let mut c = db();
    let a = create(&mut c, "A");
    let b = create(&mut c, "B");
    for id in ["a", "b", "c"] {
        mutate(
            &mut c,
            Mutation::Assign {
                session_id: id.into(),
                section_id: Some(a.clone()),
            },
        )
        .unwrap();
    }
    assert_eq!(page_ids(&c, &a, None, 1).unwrap(), vec!["a", "b"]);
    assert_eq!(page_ids(&c, &a, Some("a"), 1).unwrap(), vec!["b", "c"]);
    assert_eq!(page_ids(&c, &a, Some("b"), 1).unwrap(), vec!["c"]);
    mutate(
        &mut c,
        Mutation::Reorder {
            ids: vec![b.clone(), a.clone()],
        },
    )
    .unwrap();
    init(&c).unwrap();
    assert_eq!(snapshot(&c).unwrap().sections[0].id, b);
    assert_eq!(snapshot(&c).unwrap().members.len(), 3);
    assert!(page_ids(&c, &a, None, 0).is_err());
}

#[test]
fn persists_across_reopened_database_without_touching_session_metadata() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let id;
    {
        let mut c = Connection::open(file.path()).unwrap();
        init(&c).unwrap();
        c.execute_batch("CREATE TABLE sessions(session_id TEXT PRIMARY KEY, project TEXT, pinned INTEGER); INSERT INTO sessions VALUES('old','project-a',1);").unwrap();
        id = create(&mut c, "Research");
        mutate(
            &mut c,
            Mutation::Assign {
                session_id: "old".into(),
                section_id: Some(id.clone()),
            },
        )
        .unwrap();
    }
    let mut c = Connection::open(file.path()).unwrap();
    init(&c).unwrap();
    assert_eq!(snapshot(&c).unwrap().members[0].section_id, id);
    mutate(&mut c, Mutation::Delete { id }).unwrap();
    let unchanged: (String, i64) = c
        .query_row(
            "SELECT project,pinned FROM sessions WHERE session_id='old'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(unchanged, ("project-a".into(), 1));
}

#[test]
fn wire_contract_accepts_create_and_clear_membership() {
    let mut c = db();
    let create: Mutation =
        serde_json::from_value(serde_json::json!({"kind":"create","name":"A","sessionId":null}))
            .unwrap();
    let s = mutate(&mut c, create).unwrap();
    let id = s.sections[0].id.clone();
    let assign: Mutation = serde_json::from_value(
        serde_json::json!({"kind":"assign","sessionId":"old","sectionId":id}),
    )
    .unwrap();
    let wire = serde_json::to_value(mutate(&mut c, assign).unwrap()).unwrap();
    assert_eq!(wire["members"][0]["sessionId"], "old");
    let clear: Mutation = serde_json::from_value(
        serde_json::json!({"kind":"assign","sessionId":"old","sectionId":null}),
    )
    .unwrap();
    assert!(mutate(&mut c, clear).unwrap().members.is_empty());
}

#[test]
fn section_count_is_bounded_at_the_write_boundary() {
    let mut c = db();
    for _ in 0..MAX_SECTIONS {
        create(&mut c, "Section");
    }
    assert!(mutate(
        &mut c,
        Mutation::Create {
            name: "Overflow".into(),
            session_id: None
        }
    )
    .is_err());
    assert_eq!(snapshot(&c).unwrap().sections.len(), MAX_SECTIONS);
}
