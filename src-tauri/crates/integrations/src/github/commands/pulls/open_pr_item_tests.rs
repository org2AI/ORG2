use super::*;

#[test]
fn list_pagination_keeps_defaults_and_bounds_page_size() {
    assert_eq!(
        pull_request_list_path("org/repo", "open", None, None),
        "/repos/org/repo/pulls?state=open&sort=updated&direction=desc&per_page=30&page=1"
    );
    assert!(
        pull_request_list_path("org/repo", "open", Some(500), Some(2))
            .ends_with("per_page=100&page=2")
    );
    assert!(
        pull_request_list_path("org/repo", "closed", Some(0), Some(0))
            .ends_with("per_page=1&page=1")
    );
}

#[test]
fn serializes_author_and_only_outstanding_requested_reviewers() {
    let item = json!({
        "number": 17,
        "html_url": "https://github.com/acme/repo/pull/17",
        "title": "Ship personal PR inbox",
        "state": "open",
        "merged_at": null,
        "user": {
            "login": "author",
            "avatar_url": "https://avatars.example/author"
        },
        "requested_reviewers": [
            { "login": "viewer" },
            { "login": "second-reviewer" }
        ],
        "head": { "ref": "feature/personal-prs" },
        "base": { "ref": "main" },
        "draft": false,
        "created_at": "2026-07-30T08:00:00Z",
        "updated_at": "2026-07-30T09:00:00Z"
    });

    let serialized = serde_json::to_value(parse_open_pr_item(&item)).unwrap();

    assert_eq!(serialized["author_login"], "author");
    assert_eq!(
        serialized["author_avatar_url"],
        "https://avatars.example/author"
    );
    assert_eq!(
        serialized["requested_reviewer_logins"],
        json!(["viewer", "second-reviewer"])
    );
    assert_eq!(serialized["state"], "open");
    assert_eq!(serialized["ci_status"], "unavailable");
    assert_eq!(serialized["additions"], Value::Null);
    assert_eq!(serialized["deletions"], Value::Null);
}

#[test]
fn keeps_merged_state_and_defaults_missing_identity_fields() {
    let item = json!({
        "number": 18,
        "state": "closed",
        "merged_at": "2026-07-30T10:00:00Z",
        "head": {},
        "base": {}
    });

    let serialized = serde_json::to_value(parse_open_pr_item(&item)).unwrap();

    assert_eq!(serialized["state"], "merged");
    assert_eq!(serialized["author_login"], "");
    assert_eq!(serialized["author_avatar_url"], Value::Null);
    assert_eq!(serialized["requested_reviewer_logins"], json!([]));
}

#[test]
fn maps_batched_pull_request_list_metadata() {
    assert!(PULL_REQUEST_LIST_METADATA_QUERY.contains("nodes(ids: $ids)"));
    assert!(PULL_REQUEST_LIST_METADATA_QUERY.contains("additions"));
    assert!(PULL_REQUEST_LIST_METADATA_QUERY.contains("deletions"));
    assert!(PULL_REQUEST_LIST_METADATA_QUERY.contains("contexts(first: 100)"));

    let mut items = vec![
        parse_open_pr_item(&json!({ "number": 17 })),
        parse_open_pr_item(&json!({ "number": 18 })),
        parse_open_pr_item(&json!({ "number": 19 })),
        parse_open_pr_item(&json!({ "number": 20 })),
        parse_open_pr_item(&json!({ "number": 21 })),
        parse_open_pr_item(&json!({ "number": 22 })),
    ];

    apply_pull_request_list_metadata(
        &mut items,
        &json!({
            "data": {
                "nodes": [
                    {
                        "number": 17,
                        "additions": 45,
                        "deletions": 12,
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "statusCheckRollup": { "state": "SUCCESS" }
                                }
                            }]
                        }
                    },
                    {
                        "number": 18,
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "statusCheckRollup": { "state": "PENDING" }
                                }
                            }]
                        }
                    },
                    {
                        "number": 21,
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "statusCheckRollup": {
                                        "state": "PENDING",
                                        "contexts": {
                                            "nodes": [
                                                {
                                                    "__typename": "CheckRun",
                                                    "conclusion": "FAILURE"
                                                },
                                                {
                                                    "__typename": "CheckRun",
                                                    "conclusion": null
                                                }
                                            ]
                                        }
                                    }
                                }
                            }]
                        }
                    },
                    {
                        "number": 19,
                        "commits": {
                            "nodes": [{
                                "commit": { "statusCheckRollup": null }
                            }]
                        }
                    },
                    {
                        "number": 20,
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "statusCheckRollup": { "state": "FAILURE" }
                                }
                            }]
                        }
                    }
                ]
            }
        }),
    );

    assert_eq!(items[0].ci_status, PullRequestCiStatus::Success);
    assert_eq!(items[0].additions, Some(45));
    assert_eq!(items[0].deletions, Some(12));
    assert_eq!(items[1].ci_status, PullRequestCiStatus::Pending);
    assert_eq!(items[1].additions, None);
    assert_eq!(items[1].deletions, None);
    assert_eq!(items[2].ci_status, PullRequestCiStatus::None);
    assert_eq!(items[3].ci_status, PullRequestCiStatus::Failure);
    assert_eq!(items[4].ci_status, PullRequestCiStatus::Failure);
    // Missing/failed enrichment is unknown, never reported as passing or no checks.
    assert_eq!(items[5].ci_status, PullRequestCiStatus::Unavailable);
}

#[test]
fn accepts_only_mutable_pull_request_states() {
    assert_eq!(
        validate_pull_request_state("open".to_string()).unwrap(),
        "open"
    );
    assert_eq!(
        validate_pull_request_state("closed".to_string()).unwrap(),
        "closed"
    );
    assert!(validate_pull_request_state("merged".to_string()).is_err());
}

#[tokio::test]
async fn branch_lookup_prefers_open_and_returns_display_metadata() {
    let mut calls = Vec::new();
    let pr = find_branch_pull_request("org/repo", "feature/a&b", true, |path| {
        calls.push(path);
        std::future::ready(Ok(json!([{
            "number": 42, "html_url": "https://github.com/org/repo/pull/42",
            "title": "Rail PR", "state": "open", "draft": true
        }])))
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].contains("head=org%3Afeature%2Fa%26b"));
    assert_eq!(pr.title, "Rail PR");
    assert!(pr.draft);
    assert_eq!(pr.state, "open");
}

#[tokio::test]
async fn branch_lookup_closed_fallback_is_opt_in_and_bounded() {
    for include_closed in [false, true] {
        let mut calls = Vec::new();
        let pr = find_branch_pull_request("org/repo", "feature", include_closed, |path| {
            let closed = path.contains("state=closed");
            calls.push(path);
            std::future::ready(Ok(if closed {
                json!([{
                    "number": 41, "html_url": "https://github.com/org/repo/pull/41",
                    "title": "Merged PR", "state": "closed", "merged_at": "2026-09-25T00:00:00Z"
                }])
            } else {
                json!([])
            }))
        })
        .await
        .unwrap();
        assert_eq!(calls.len(), if include_closed { 2 } else { 1 });
        if include_closed {
            assert_eq!(pr.unwrap().state, "merged");
            assert!(calls[1].contains("sort=updated&direction=desc&per_page=1"));
        } else {
            assert!(pr.is_none());
        }
    }
}

#[tokio::test]
async fn branch_lookup_preserves_error_instead_of_treating_it_as_empty() {
    let mut calls = 0;
    let result = find_branch_pull_request("org/repo", "feature", true, |_| {
        calls += 1;
        std::future::ready(Err("unauthorized".to_string()))
    })
    .await;
    assert_eq!(result.unwrap_err(), "unauthorized");
    assert_eq!(calls, 1);
}

#[test]
fn branch_lookup_distinguishes_closed_from_merged() {
    let pr = parse_found_pull_request(&json!([{
        "number": 40, "html_url": "https://github.com/org/repo/pull/40",
        "title": "Closed PR", "state": "closed", "merged_at": null
    }]))
    .unwrap();
    assert_eq!(pr.state, "closed");
    assert!(!pr.draft);
}
