-- Frozen SQLite DDL validated against the production fingerprint at
-- 6968a34d529c5e4c627e91b647bdd38b17139075 and 22767a2a4f3185b127bf6d5669302cffcbe6dce4.
-- Runtime fingerprint: d96f244c1ddb4293c82109cf8dc4ca0a41179f4aa464a22b81c69ffe65f9313c
-- Includes six companion tables. Test-only upgrade input; contains no user data.

CREATE TABLE agent_org_coordinator_completion_rechecks (
            org_run_id TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            source_turn_intent_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL,
            work_revision INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','materialized','resolved')),
            inbox_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(org_run_id,source_session_id,source_turn_intent_id),
            FOREIGN KEY(inbox_id) REFERENCES agent_org_runtime_inbox(id) ON DELETE SET NULL
        );

CREATE TABLE agent_org_member_turn_admissions (
            session_id TEXT NOT NULL,
            turn_intent_id TEXT NOT NULL,
            org_run_id TEXT NOT NULL,
            member_id TEXT NOT NULL CHECK(length(trim(member_id)) > 0),
            reservation_id TEXT NOT NULL CHECK(length(trim(reservation_id)) > 0),
            runtime_lease_id TEXT NOT NULL CHECK(length(trim(runtime_lease_id)) > 0),
            status TEXT NOT NULL CHECK(status IN (
                'prepared','committed','rejected','unknown'
            )),
            reason_code TEXT,
            prepared_at TEXT NOT NULL,
            committed_at TEXT,
            terminal_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(session_id, turn_intent_id),
            UNIQUE(reservation_id),
            FOREIGN KEY(session_id, turn_intent_id)
                REFERENCES session_turn_intents(session_id, turn_intent_id)
                ON DELETE CASCADE,
            FOREIGN KEY(org_run_id)
                REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK(
                (status='prepared' AND committed_at IS NULL AND terminal_at IS NULL)
                OR (status='committed' AND committed_at IS NOT NULL AND terminal_at IS NULL)
                OR (status IN ('rejected','unknown') AND terminal_at IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_archive_episodes (
            archive_receipt_id TEXT PRIMARY KEY CHECK(length(trim(archive_receipt_id)) > 0),
            org_run_id TEXT NOT NULL UNIQUE,
            archive_request_id TEXT NOT NULL CHECK(length(trim(archive_request_id)) > 0),
            archive_generation INTEGER NOT NULL CHECK(archive_generation >= 2),
            teardown_status TEXT NOT NULL CHECK(teardown_status IN (
                'pending','quiesced','retained_runtime'
            )),
            teardown_attempt_count INTEGER NOT NULL DEFAULT 0
                CHECK(teardown_attempt_count BETWEEN 0 AND 3),
            retained_runtime_count INTEGER NOT NULL DEFAULT 0
                CHECK(retained_runtime_count >= 0),
            task_cancel_count INTEGER NOT NULL DEFAULT 0 CHECK(task_cancel_count >= 0),
            turn_cancel_count INTEGER NOT NULL DEFAULT 0 CHECK(turn_cancel_count >= 0),
            inbox_cancel_count INTEGER NOT NULL DEFAULT 0 CHECK(inbox_cancel_count >= 0),
            approval_cancel_count INTEGER NOT NULL DEFAULT 0 CHECK(approval_cancel_count >= 0),
            intervention_cancel_count INTEGER NOT NULL DEFAULT 0 CHECK(intervention_cancel_count >= 0),
            pause_continuation_cancel_count INTEGER NOT NULL DEFAULT 0
                CHECK(pause_continuation_cancel_count >= 0),
            deadline_at TEXT NOT NULL,
            last_error TEXT,
            archived_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            quiesced_at TEXT,
            UNIQUE(org_run_id, archive_request_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK(
                (teardown_status='quiesced' AND quiesced_at IS NOT NULL
                 AND retained_runtime_count=0)
                OR
                (teardown_status<>'quiesced' AND quiesced_at IS NULL)
            )
        );

CREATE TABLE agent_org_runtime_archive_teardowns (
            teardown_id TEXT PRIMARY KEY CHECK(length(trim(teardown_id)) > 0),
            archive_receipt_id TEXT NOT NULL,
            org_run_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            member_id TEXT,
            captured_parent_session_id TEXT,
            teardown_status TEXT NOT NULL CHECK(teardown_status IN (
                'pending','quiesced','retained_runtime'
            )),
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
            runtime_lease_id TEXT,
            dialog_turn_generation TEXT,
            last_error TEXT,
            released_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(archive_receipt_id, session_id),
            FOREIGN KEY(archive_receipt_id)
                REFERENCES agent_org_runtime_archive_episodes(archive_receipt_id) ON DELETE CASCADE,
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK(
                (teardown_status='quiesced' AND released_at IS NOT NULL)
                OR
                (teardown_status<>'quiesced' AND released_at IS NULL)
            ),
            CHECK(
                (runtime_lease_id IS NULL AND dialog_turn_generation IS NULL)
                OR runtime_lease_id IS NOT NULL
            )
        );

CREATE TABLE agent_org_runtime_final_summary_receipts (
            receipt_id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL CHECK(activation_generation >= 1),
            certificate_id TEXT NOT NULL,
            evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64),
            attempt INTEGER NOT NULL CHECK(attempt >= 1),
            status TEXT NOT NULL CHECK(status IN (
                'pending','running','persisting','persisted','failed'
            )),
            coordinator_session_id TEXT NOT NULL CHECK(trim(coordinator_session_id) <> ''),
            turn_intent_id TEXT,
            retry_request_id TEXT,
            started_at TEXT,
            terminal_at TEXT,
            event_id TEXT,
            typed_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(certificate_id,attempt),
            UNIQUE(certificate_id,retry_request_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(certificate_id)
                REFERENCES agent_org_runtime_run_completion_certificates(id)
                ON DELETE CASCADE,
            CHECK((status='pending' AND turn_intent_id IS NULL AND started_at IS NULL)
               OR (status IN ('running','persisting','persisted','failed')
                   AND turn_intent_id IS NOT NULL AND started_at IS NOT NULL)),
            CHECK((status IN ('persisted','failed'))=(terminal_at IS NOT NULL)),
            CHECK((status='persisted')=(event_id IS NOT NULL)),
            CHECK((status='failed')=(typed_error IS NOT NULL))
        );

CREATE TABLE agent_org_runtime_formal_trigger_attempts (
            receipt_id TEXT NOT NULL,
            attempt INTEGER NOT NULL CHECK(attempt >= 1),
            session_id TEXT NOT NULL,
            turn_intent_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('queued','running','failed','resolved')),
            materialized_input_id TEXT NOT NULL,
            materialized_event_id TEXT,
            typed_error TEXT,
            queued_at TEXT NOT NULL,
            started_at TEXT,
            terminal_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(receipt_id,attempt),
            FOREIGN KEY(receipt_id)
                REFERENCES agent_org_runtime_formal_trigger_receipts(receipt_id)
                ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_formal_trigger_receipts (
            receipt_id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            trigger_kind TEXT NOT NULL,
            trigger_id TEXT NOT NULL,
            trigger_revision INTEGER NOT NULL CHECK(trigger_revision >= 1),
            source_kind TEXT NOT NULL,
            target_member_id TEXT NOT NULL CHECK(target_member_id='coordinator'),
            inbox_id INTEGER,
            task_id TEXT,
            owner_member_id TEXT,
            source_turn_intent_id TEXT,
            task_output_digest TEXT CHECK(
                task_output_digest IS NULL OR length(task_output_digest)=64
            ),
            plan_revision_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending','materialized','resolved')),
            doorbell_status TEXT NOT NULL CHECK(doorbell_status IN ('missing','delivered','suppressed')),
            doorbell_delivered_at TEXT,
            current_attempt INTEGER NOT NULL DEFAULT 0 CHECK(current_attempt >= 0),
            materialized_input_id TEXT,
            materialized_event_id TEXT,
            resolved_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(org_run_id,trigger_kind,trigger_id,trigger_revision),
            UNIQUE(inbox_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(inbox_id) REFERENCES agent_org_runtime_inbox(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_inbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_class TEXT NOT NULL DEFAULT 'formal_work'
                CHECK(delivery_class IN ('formal_work','user_directed')),
            recipient_agent_id TEXT NOT NULL,
            recipient_member_id TEXT,
            sender_agent_id TEXT NOT NULL,
            sender_member_id TEXT,
            org_run_id TEXT,
            payload_kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            request_id TEXT,
            created_at TEXT NOT NULL,
            read_at TEXT,
            causation_inbox_id INTEGER,
            display_text TEXT,
            client_message_id TEXT
            ,source_turn_intent_id TEXT
        );

CREATE TABLE agent_org_runtime_inbox_delivery_resolutions (
            inbox_id INTEGER PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            resolution_kind TEXT NOT NULL
                CHECK(resolution_kind IN ('cancelled', 'superseded', 'system_reconciled')),
            resolved_by_member_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            replacement_inbox_id INTEGER,
            replacement_task_id TEXT,
            created_at TEXT NOT NULL,
            CHECK(
                (resolution_kind IN ('cancelled','system_reconciled')
                    AND replacement_inbox_id IS NULL
                    AND replacement_task_id IS NULL)
                OR
                (resolution_kind='superseded'
                    AND ((replacement_inbox_id IS NOT NULL)
                         <> (replacement_task_id IS NOT NULL)))
            )
        );

CREATE TABLE agent_org_runtime_inbox_materializations (
            inbox_id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            transcript_message_id TEXT NOT NULL,
            transcript_intent_id TEXT NOT NULL,
            materialized_at TEXT NOT NULL
        );

CREATE TABLE agent_org_runtime_inbox_task_bindings (
            inbox_id INTEGER PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            recipient_member_id TEXT NOT NULL,
            binding_kind TEXT NOT NULL CHECK(binding_kind='coordinator_task_message'),
            source_turn_intent_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(inbox_id)
                REFERENCES agent_org_runtime_inbox(id) ON DELETE CASCADE,
            FOREIGN KEY(org_run_id,task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id,id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_initial_inputs (
            org_run_id TEXT PRIMARY KEY,
            turn_intent_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            content TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN (
                'pending_persistence', 'queued', 'dispatched'
            )),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(turn_intent_id),
            UNIQUE(message_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_member_dispatch_allocators (
            org_run_id TEXT NOT NULL,
            member_id TEXT NOT NULL CHECK(length(trim(member_id)) > 0),
            next_sequence INTEGER NOT NULL CHECK(next_sequence >= 1),
            PRIMARY KEY(org_run_id, member_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_member_intervention_turns (
            intervention_receipt_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            turn_intent_id TEXT NOT NULL,
            source_event_id TEXT NOT NULL,
            dispatch_content TEXT NOT NULL CHECK(length(trim(dispatch_content)) > 0),
            display_content TEXT NOT NULL CHECK(length(trim(display_content)) > 0),
            member_dispatch_sequence INTEGER NOT NULL CHECK(member_dispatch_sequence >= 1),
            chain_position INTEGER NOT NULL CHECK(chain_position >= 1),
            status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','abandoned')),
            enqueued_at TEXT NOT NULL,
            started_at TEXT,
            terminal_at TEXT,
            failure_reason TEXT,
            PRIMARY KEY(intervention_receipt_id, turn_intent_id),
            UNIQUE(intervention_receipt_id, chain_position),
            UNIQUE(source_event_id),
            FOREIGN KEY(intervention_receipt_id)
                REFERENCES agent_org_runtime_member_interventions(intervention_receipt_id)
                ON DELETE CASCADE,
            FOREIGN KEY(session_id, turn_intent_id)
                REFERENCES session_turn_intents(session_id, turn_intent_id)
                ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_member_interventions (
            intervention_receipt_id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            member_id TEXT NOT NULL CHECK(length(trim(member_id)) > 0),
            agent_id TEXT NOT NULL CHECK(length(trim(agent_id)) > 0),
            session_id TEXT NOT NULL CHECK(length(trim(session_id)) > 0),
            status TEXT NOT NULL CHECK(status IN (
                'yield_requested','active','return_requested','cleared','failed'
            )),
            source_event_id TEXT NOT NULL CHECK(length(trim(source_event_id)) > 0),
            original_task_id TEXT,
            original_turn_intent_id TEXT,
            original_member_dispatch_sequence INTEGER,
            runtime_lease_id TEXT,
            dialog_turn_generation TEXT,
            entered_at TEXT NOT NULL,
            last_user_activity_at TEXT NOT NULL,
            yield_requested_at TEXT,
            yield_released_at TEXT,
            yield_timed_out_at TEXT,
            return_request_id TEXT,
            return_outcome TEXT CHECK(return_outcome IS NULL OR return_outcome IN (
                'restored_task','cleared_paused','cleared_idle','no_longer_needed'
            )),
            continuation_turn_intent_id TEXT,
            cleared_revision INTEGER,
            cleared_at TEXT,
            failure_reason TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK((runtime_lease_id IS NULL) = (dialog_turn_generation IS NULL)),
            CHECK((original_task_id IS NULL) = (original_turn_intent_id IS NULL)),
            CHECK((cleared_at IS NULL) = (status NOT IN ('cleared','failed')))
        );

CREATE TABLE agent_org_runtime_member_materializations (
            org_run_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            generation INTEGER NOT NULL CHECK(generation >= 1),
            session_id TEXT NOT NULL,
            authority_class TEXT NOT NULL CHECK(authority_class IN (
                'starting', 'formal', 'user_directed'
            )),
            status TEXT NOT NULL CHECK(status IN (
                'pending', 'succeeded', 'failed'
            )),
            error_code TEXT,
            error_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(org_run_id, member_id, generation),
            UNIQUE(org_run_id, session_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_pause_episodes (
            episode_id TEXT PRIMARY KEY CHECK(length(trim(episode_id)) > 0),
            org_run_id TEXT NOT NULL,
            pause_request_id TEXT NOT NULL CHECK(length(trim(pause_request_id)) > 0),
            pause_generation INTEGER NOT NULL CHECK(pause_generation >= 2),
            status TEXT NOT NULL CHECK(status IN ('active','consumed')),
            resume_request_id TEXT,
            resume_generation INTEGER,
            teardown_owner_id TEXT NOT NULL CHECK(length(trim(teardown_owner_id)) > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            resumed_at TEXT,
            UNIQUE(org_run_id, pause_request_id),
            UNIQUE(resume_request_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK(
                (status='active' AND resume_request_id IS NULL
                 AND resume_generation IS NULL AND resumed_at IS NULL)
                OR
                (status='consumed' AND resume_request_id IS NOT NULL
                 AND resume_generation IS NOT NULL AND resume_generation > pause_generation
                 AND resumed_at IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_pause_handoffs (
            handoff_id TEXT PRIMARY KEY CHECK(length(trim(handoff_id)) > 0),
            episode_id TEXT NOT NULL,
            org_run_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            original_turn_intent_id TEXT NOT NULL,
            turn_kind TEXT NOT NULL CHECK(turn_kind IN ('coordinator','task_execution')),
            participant_id TEXT NOT NULL,
            task_id TEXT,
            original_owner_member_id TEXT,
            original_activation_generation INTEGER NOT NULL CHECK(original_activation_generation >= 1),
            original_intent_status TEXT NOT NULL CHECK(original_intent_status IN ('queued','running')),
            drain_status TEXT NOT NULL CHECK(drain_status IN (
                'waiting','released','runtime_absent','timed_out'
            )),
            runtime_lease_id TEXT,
            dialog_turn_generation TEXT,
            yield_requested_at TEXT,
            released_at TEXT,
            drain_timeout_at TEXT,
            drain_error TEXT,
            continuation_turn_intent_id TEXT,
            continuation_status TEXT CHECK(continuation_status IN ('queued','dispatched','skipped')),
            skip_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(episode_id, session_id, original_turn_intent_id),
            UNIQUE(continuation_turn_intent_id),
            FOREIGN KEY(episode_id) REFERENCES agent_org_runtime_pause_episodes(episode_id) ON DELETE CASCADE,
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id, original_turn_intent_id)
                REFERENCES agent_org_runtime_turn_contexts(session_id, turn_intent_id)
                ON DELETE CASCADE,
            CHECK(
                (turn_kind='coordinator' AND task_id IS NULL AND original_owner_member_id IS NULL)
                OR
                (turn_kind='task_execution' AND task_id IS NOT NULL
                 AND original_owner_member_id=participant_id)
            ),
            CHECK(
                (runtime_lease_id IS NULL AND dialog_turn_generation IS NULL)
                OR
                (runtime_lease_id IS NOT NULL AND dialog_turn_generation IS NOT NULL)
            ),
            CHECK(
                (continuation_status IS NULL AND continuation_turn_intent_id IS NULL AND skip_reason IS NULL)
                OR
                (continuation_status IN ('queued','dispatched')
                 AND continuation_turn_intent_id IS NOT NULL AND skip_reason IS NULL)
                OR
                (continuation_status='skipped' AND skip_reason IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_plan_decisions (
            approval_id TEXT PRIMARY KEY,
            plan_revision_id TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL UNIQUE,
            policy TEXT NOT NULL CHECK(policy IN ('coordinator','user','automatic')),
            status TEXT NOT NULL CHECK(status IN (
                'pending','approved','changes_requested','superseded','cancelled'
            )),
            decision_by TEXT CHECK(decision_by IS NULL OR decision_by IN (
                'user','coordinator','automatic'
            )),
            feedback TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            FOREIGN KEY(plan_revision_id)
                REFERENCES agent_org_runtime_plan_revisions(plan_revision_id)
                ON DELETE CASCADE,
            CHECK(
                (status='pending' AND decision_by IS NULL AND resolved_at IS NULL)
                OR
                (status!='pending' AND decision_by IS NOT NULL AND resolved_at IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_plan_revisions (
            plan_revision_id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            source_task_id TEXT NOT NULL,
            source_member_id TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            source_turn_intent_id TEXT NOT NULL,
            root_session_id TEXT NOT NULL,
            revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
            previous_plan_revision_id TEXT,
            plan_title TEXT NOT NULL,
            plan_path TEXT NOT NULL,
            plan_content TEXT NOT NULL,
            content_digest TEXT NOT NULL CHECK(length(content_digest)=64),
            created_at TEXT NOT NULL,
            UNIQUE(org_run_id, source_task_id, revision_number),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(previous_plan_revision_id)
                REFERENCES agent_org_runtime_plan_revisions(plan_revision_id)
        );

CREATE TABLE agent_org_runtime_recovery_attempts (
            org_run_id TEXT NOT NULL,
            action_kind TEXT NOT NULL,
            target_key TEXT NOT NULL,
            reason_fingerprint TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_allowed_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reservation_token TEXT,
            PRIMARY KEY (org_run_id, action_kind, target_key)
        );

CREATE TABLE agent_org_runtime_run_completion_certificates (
            id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL CHECK(activation_generation >= 1),
            work_revision INTEGER NOT NULL CHECK(work_revision >= 0),
            request_id TEXT NOT NULL CHECK(trim(request_id) <> ''),
            request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
            outcome TEXT NOT NULL CHECK(outcome IN ('delivered','cancelled','failed')),
            summary TEXT NOT NULL CHECK(trim(summary) <> ''),
            coordinator_session_id TEXT NOT NULL CHECK(trim(coordinator_session_id) <> ''),
            coordinator_turn_intent_id TEXT NOT NULL CHECK(trim(coordinator_turn_intent_id) <> ''),
            evidence_task_ids_json TEXT NOT NULL CHECK(json_valid(evidence_task_ids_json)=1 AND json_type(evidence_task_ids_json)='array'),
            closure_task_ids_json TEXT NOT NULL CHECK(json_valid(closure_task_ids_json)=1 AND json_type(closure_task_ids_json)='array'),
            task_output_refs_json TEXT NOT NULL CHECK(json_valid(task_output_refs_json)=1 AND json_type(task_output_refs_json)='array'),
            resolution_links_json TEXT NOT NULL CHECK(json_valid(resolution_links_json)=1 AND json_type(resolution_links_json)='array'),
            validator_version INTEGER NOT NULL CHECK(validator_version=1),
            created_at TEXT NOT NULL,
            UNIQUE(org_run_id, request_id),
            FOREIGN KEY (org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_run_progress (
            org_run_id TEXT PRIMARY KEY,
            work_revision INTEGER NOT NULL DEFAULT 0 CHECK(work_revision >= 0),
            coordinator_presented_work_revision INTEGER,
            coordinator_observed_work_revision INTEGER,
            completion_requested INTEGER NOT NULL DEFAULT 0,
            completion_requested_at TEXT,
            completion_requested_work_revision INTEGER,
            completion_summary TEXT,
            completion_candidate_json TEXT CHECK(completion_candidate_json IS NULL OR json_valid(completion_candidate_json)=1),
            updated_at TEXT NOT NULL,
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_runs (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            coordinator_agent_id TEXT NOT NULL,
            root_session_id TEXT,
            org_snapshot_json TEXT,
            entry_mode TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN (
                'starting', 'running', 'paused', 'idle', 'failed', 'archived'
            )),
            activation_generation INTEGER NOT NULL DEFAULT 1
                CHECK(activation_generation >= 1),
            has_initial_work INTEGER NOT NULL DEFAULT 0
                CHECK(has_initial_work IN (0, 1)),
            work_item_id TEXT,
            project_slug TEXT,
            routine_fire_id TEXT,
            summary TEXT,
            last_error TEXT,
            failure_json TEXT,
            last_activity_outcome TEXT CHECK(last_activity_outcome IN (
                'completed', 'failed', 'cancelled'
            )),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            idled_at TEXT,
            archived_at TEXT,
            archive_receipt_id TEXT UNIQUE,
            CHECK(
                (status='archived' AND archived_at IS NOT NULL AND archive_receipt_id IS NOT NULL)
                OR
                (status<>'archived' AND archived_at IS NULL AND archive_receipt_id IS NULL)
            )
        );

CREATE TABLE agent_org_runtime_task_annotations (
            id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('progress','evidence','audit_note')),
            body TEXT NOT NULL CHECK(trim(body) <> ''),
            actor_kind TEXT NOT NULL CHECK(actor_kind IN ('graph_writer','owner_execution','system')),
            actor_participant_id TEXT NOT NULL CHECK(trim(actor_participant_id) <> ''),
            source_turn_intent_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (org_run_id, task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_task_events (
            id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            previous_owner TEXT,
            next_owner TEXT,
            previous_status TEXT,
            next_status TEXT,
            actor_member_id TEXT,
            actor_kind TEXT NOT NULL CHECK(actor_kind IN ('graph_writer','owner_execution','system')),
            source_turn_intent_id TEXT,
            created_at TEXT NOT NULL
        );

CREATE TABLE agent_org_runtime_task_execution_handoffs (
            id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL CHECK(activation_generation >= 1),
            request_id TEXT NOT NULL CHECK(trim(request_id) <> ''),
            request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
            old_task_id TEXT NOT NULL,
            old_owner_member_id TEXT NOT NULL CHECK(trim(old_owner_member_id) <> ''),
            old_session_id TEXT,
            old_turn_intent_id TEXT,
            runtime_lease_id TEXT,
            dialog_turn_generation TEXT,
            replacement_task_id TEXT,
            state TEXT NOT NULL CHECK(state IN ('requested','yielding','released','timeout','unknown','failed')),
            slo_missed INTEGER NOT NULL DEFAULT 0 CHECK(slo_missed IN (0,1)),
            external_effect_unknown INTEGER NOT NULL DEFAULT 0 CHECK(external_effect_unknown IN (0,1)),
            local_effect_count INTEGER NOT NULL DEFAULT 0 CHECK(local_effect_count >= 0),
            resolution_request_id TEXT,
            resolution_session_id TEXT,
            requested_resolution TEXT CHECK(requested_resolution IN ('continue_replacement','keep_stopped','abandon_episode')),
            resolution_attempt INTEGER NOT NULL DEFAULT 0 CHECK(resolution_attempt >= 0),
            resolution_requested_at TEXT,
            resolution TEXT CHECK(resolution IN ('continue_replacement','keep_stopped','abandon_episode')),
            requested_at TEXT NOT NULL,
            released_at TEXT,
            resolved_at TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(org_run_id, activation_generation, request_id),
            UNIQUE(org_run_id, activation_generation, resolution_request_id),
            UNIQUE(org_run_id, activation_generation, old_task_id, old_turn_intent_id),
            FOREIGN KEY (org_run_id, old_task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id),
            FOREIGN KEY (org_run_id, replacement_task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id),
            CHECK((old_session_id IS NULL) = (old_turn_intent_id IS NULL)),
            CHECK((runtime_lease_id IS NULL) = (dialog_turn_generation IS NULL)),
            CHECK(runtime_lease_id IS NULL OR old_session_id IS NOT NULL),
            CHECK(state <> 'released' OR released_at IS NOT NULL),
            CHECK(
                (requested_resolution IS NULL AND resolution_request_id IS NULL
                    AND resolution_session_id IS NULL AND resolution_attempt=0
                    AND resolution_requested_at IS NULL)
                OR
                (requested_resolution IS NOT NULL AND resolution_request_id IS NOT NULL
                    AND resolution_session_id IS NOT NULL AND resolution_attempt>=1
                    AND resolution_requested_at IS NOT NULL)
            ),
            CHECK(resolution IS NULL OR (
                resolved_at IS NOT NULL AND resolution=requested_resolution
            ))
        );

CREATE TABLE agent_org_runtime_tasks (
            id TEXT NOT NULL,
            org_run_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL CHECK(activation_generation >= 1),
            subject TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            active_form TEXT,
            owner TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','failed','cancelled')),
            execution_mode TEXT NOT NULL CHECK(execution_mode IN ('build','plan')),
            blocked_by_json TEXT NOT NULL DEFAULT '[]',
            metadata_json TEXT,
            output_json TEXT,
            failure_reason_json TEXT,
            cancel_reason_json TEXT,
            external_effect_unknown INTEGER NOT NULL DEFAULT 0
                CHECK(external_effect_unknown IN (0,1)),
            created_by_participant_id TEXT NOT NULL CHECK(trim(created_by_participant_id) <> ''),
            source_turn_intent_id TEXT NOT NULL CHECK(trim(source_turn_intent_id) <> ''),
            originating_message_id TEXT,
            replaces_task_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (org_run_id, id),
            FOREIGN KEY (org_run_id, replaces_task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id),
            CHECK(owner IS NULL OR (trim(owner) <> '' AND owner <> 'coordinator')),
            CHECK(replaces_task_id IS NULL OR replaces_task_id <> id),
            CHECK(json_valid(blocked_by_json)=1 AND json_type(blocked_by_json)='array'),
            CHECK(metadata_json IS NULL OR (
                json_valid(metadata_json)=1 AND json_type(metadata_json)='object'
                AND json_type(metadata_json,'$.output') IS NULL
                AND json_type(metadata_json,'$.execution_mode') IS NULL
            )),
            CHECK(output_json IS NULL OR (json_valid(output_json)=1 AND json_type(output_json)='object')),
            CHECK(failure_reason_json IS NULL OR (json_valid(failure_reason_json)=1 AND json_type(failure_reason_json)='object')),
            CHECK(cancel_reason_json IS NULL OR (json_valid(cancel_reason_json)=1 AND json_type(cancel_reason_json)='object')),
            CHECK(status NOT IN ('in_progress','completed','failed') OR owner IS NOT NULL),
            CHECK(
                (status IN ('pending','in_progress') AND output_json IS NULL AND failure_reason_json IS NULL AND cancel_reason_json IS NULL)
                OR (status='completed' AND output_json IS NOT NULL AND failure_reason_json IS NULL AND cancel_reason_json IS NULL)
                OR (status='failed' AND output_json IS NULL AND failure_reason_json IS NOT NULL AND cancel_reason_json IS NULL)
                OR (status='cancelled' AND output_json IS NULL AND failure_reason_json IS NULL AND cancel_reason_json IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_tool_call_receipts (
             org_run_id TEXT NOT NULL,
             session_id TEXT NOT NULL,
             turn_intent_id TEXT NOT NULL,
             call_id TEXT NOT NULL,
             tool_name TEXT NOT NULL,
             operation TEXT NOT NULL,
             canonical_digest TEXT NOT NULL,
             result_text TEXT,
             error_kind TEXT,
             error_text TEXT,
             created_at TEXT NOT NULL,
             PRIMARY KEY (org_run_id, session_id, turn_intent_id, call_id),
             FOREIGN KEY (org_run_id)
                 REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
             CHECK (trim(org_run_id) <> '' AND org_run_id = trim(org_run_id)),
             CHECK (trim(session_id) <> '' AND session_id = trim(session_id)),
             CHECK (trim(turn_intent_id) <> '' AND turn_intent_id = trim(turn_intent_id)),
             CHECK (trim(call_id) <> '' AND call_id = trim(call_id)),
             CHECK (trim(tool_name) <> '' AND length(CAST(tool_name AS BLOB)) <= 128),
             CHECK (trim(operation) <> '' AND length(CAST(operation AS BLOB)) <= 128),
             CHECK (length(canonical_digest) = 64 AND canonical_digest NOT GLOB '*[^0-9a-f]*'),
             CHECK (
                 (result_text IS NOT NULL AND error_kind IS NULL AND error_text IS NULL)
                 OR
                 (result_text IS NULL AND error_kind IN ('invalid_params','execution_failed','permission_denied','timeout') AND error_text IS NOT NULL)
             ),
             CHECK (result_text IS NULL OR length(CAST(result_text AS BLOB)) <= 524288),
             CHECK (error_text IS NULL OR length(CAST(error_text AS BLOB)) <= 65536),
             CHECK (length(created_at) <= 64 AND length(CAST(created_at AS BLOB)) <= 256)
         );

CREATE TABLE agent_org_runtime_turn_contexts (
            context_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL CHECK(length(trim(session_id)) > 0),
            turn_intent_id TEXT NOT NULL CHECK(length(trim(turn_intent_id)) > 0),
            org_run_id TEXT NOT NULL,
            participant_id TEXT NOT NULL CHECK(length(trim(participant_id)) > 0),
            turn_kind TEXT NOT NULL,
            task_id TEXT,
            owner_member_id TEXT,
            dispatch_member_id TEXT,
            member_dispatch_sequence INTEGER,
            source_kind TEXT NOT NULL,
            source_id TEXT NOT NULL CHECK(length(trim(source_id)) > 0),
            root_authority_turn_id TEXT,
            actor_version INTEGER,
            activation_generation INTEGER,
            coordinator_work_revision INTEGER,
            coordinator_presented_outputs_json TEXT NOT NULL DEFAULT '[]'
                CHECK(json_valid(coordinator_presented_outputs_json)=1
                      AND json_type(coordinator_presented_outputs_json)='array'),
            coordinator_observed_task_ids_json TEXT NOT NULL DEFAULT '[]'
                CHECK(json_valid(coordinator_observed_task_ids_json)=1
                      AND json_type(coordinator_observed_task_ids_json)='array'
                      AND json_array_length(coordinator_observed_task_ids_json) <= 32),
            terminal_reason TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(session_id, turn_intent_id),
            FOREIGN KEY(session_id, turn_intent_id)
                REFERENCES session_turn_intents(session_id, turn_intent_id)
                ON DELETE CASCADE,
            FOREIGN KEY(org_run_id)
                REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK(
                (turn_kind='coordinator'
                 AND participant_id='coordinator'
                 AND task_id IS NULL AND owner_member_id IS NULL
                 AND dispatch_member_id IS NULL AND member_dispatch_sequence IS NULL
                 AND (
                    (source_kind IN ('root_turn','group_root')
                     AND (source_kind<>'root_turn' OR source_id=turn_intent_id)
                     AND root_authority_turn_id IS NULL AND actor_version IS NULL
                     AND activation_generation IS NOT NULL AND activation_generation >= 1
                     AND (coordinator_work_revision IS NULL OR coordinator_work_revision >= 0)
                     AND (terminal_reason IS NULL OR terminal_reason='waiting_for_org_event'))
                    OR
                    (source_kind='member_inbox'
                     AND root_authority_turn_id IS NOT NULL
                     AND length(trim(root_authority_turn_id)) > 0
                     AND actor_version IS NOT NULL AND actor_version >= 1
                     AND activation_generation IS NULL
                     AND coordinator_work_revision IS NULL
                     AND coordinator_observed_task_ids_json='[]' AND terminal_reason IS NULL)
                 ))
                OR
                (turn_kind='task_execution'
                 AND task_id IS NOT NULL AND length(trim(task_id)) > 0
                 AND owner_member_id=participant_id
                 AND dispatch_member_id=participant_id
                 AND member_dispatch_sequence IS NOT NULL AND member_dispatch_sequence >= 1
                 AND source_kind='task' AND source_id=task_id
                 AND root_authority_turn_id IS NULL AND actor_version IS NULL
                 AND activation_generation IS NOT NULL AND activation_generation >= 1
                 AND coordinator_work_revision IS NULL
                 AND coordinator_observed_task_ids_json='[]' AND terminal_reason IS NULL)
                OR
                (turn_kind='user_directed_work'
                 AND task_id IS NULL AND owner_member_id IS NULL
                 AND dispatch_member_id=participant_id
                 AND member_dispatch_sequence IS NOT NULL AND member_dispatch_sequence >= 1
                 AND actor_version IS NOT NULL AND actor_version >= 1
                 AND activation_generation IS NULL
                 AND coordinator_work_revision IS NULL
                 AND coordinator_observed_task_ids_json='[]' AND terminal_reason IS NULL
                 AND (
                    (source_kind='direct_member'
                     AND root_authority_turn_id=turn_intent_id)
                    OR
                    (source_kind='group_mention'
                     AND root_authority_turn_id=turn_intent_id)
                    OR
                    (source_kind='member_inbox'
                     AND root_authority_turn_id IS NOT NULL
                     AND length(trim(root_authority_turn_id)) > 0)
                 ))
            )
        );

CREATE TABLE agent_org_runtime_user_directed_coordinator_bindings (
            binding_id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_run_id TEXT NOT NULL,
            session_id TEXT NOT NULL CHECK(length(trim(session_id)) > 0),
            turn_intent_id TEXT NOT NULL CHECK(length(trim(turn_intent_id)) > 0),
            root_authority_turn_id TEXT NOT NULL CHECK(length(trim(root_authority_turn_id)) > 0),
            parent_delivery_id INTEGER NOT NULL,
            parent_inbox_id INTEGER,
            source_inbox_id INTEGER NOT NULL,
            depth INTEGER NOT NULL CHECK(depth >= 1),
            delivery_ordinal INTEGER NOT NULL CHECK(delivery_ordinal >= 2),
            request_digest TEXT NOT NULL
                CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
            dispatch_content TEXT NOT NULL CHECK(length(trim(dispatch_content)) > 0),
            display_content TEXT NOT NULL CHECK(length(trim(display_content)) > 0),
            status TEXT NOT NULL
                CHECK(status IN ('pending','started','completed','failed','cancelled','abandoned','unknown')),
            created_at TEXT NOT NULL,
            started_at TEXT,
            terminal_at TEXT,
            failure_reason TEXT,
            UNIQUE(session_id,turn_intent_id),
            UNIQUE(source_inbox_id),
            UNIQUE(org_run_id,root_authority_turn_id,delivery_ordinal),
            FOREIGN KEY(org_run_id,root_authority_turn_id)
                REFERENCES agent_org_runtime_user_directed_roots(org_run_id,root_authority_turn_id)
                ON DELETE CASCADE,
            FOREIGN KEY(session_id,turn_intent_id)
                REFERENCES agent_org_runtime_turn_contexts(session_id,turn_intent_id)
                ON DELETE CASCADE,
            FOREIGN KEY(parent_delivery_id)
                REFERENCES agent_org_runtime_user_directed_deliveries(delivery_id) ON DELETE RESTRICT,
            FOREIGN KEY(parent_inbox_id) REFERENCES agent_org_runtime_inbox(id) ON DELETE RESTRICT,
            FOREIGN KEY(source_inbox_id) REFERENCES agent_org_runtime_inbox(id) ON DELETE RESTRICT,
            CHECK(parent_inbox_id IS NULL OR parent_inbox_id<>source_inbox_id),
            CHECK(
                (status='pending' AND started_at IS NULL AND terminal_at IS NULL AND failure_reason IS NULL)
                OR
                (status='started' AND started_at IS NOT NULL AND terminal_at IS NULL AND failure_reason IS NULL)
                OR
                (status IN ('completed','cancelled') AND started_at IS NOT NULL AND terminal_at IS NOT NULL)
                OR
                (status IN ('failed','abandoned','unknown') AND terminal_at IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_user_directed_deliveries (
            delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_run_id TEXT NOT NULL,
            session_id TEXT NOT NULL CHECK(length(trim(session_id)) > 0),
            turn_intent_id TEXT NOT NULL CHECK(length(trim(turn_intent_id)) > 0),
            root_authority_turn_id TEXT NOT NULL CHECK(length(trim(root_authority_turn_id)) > 0),
            parent_delivery_id INTEGER,
            parent_inbox_id INTEGER,
            source_kind TEXT NOT NULL
                CHECK(source_kind IN ('direct_member','group_mention','member_inbox')),
            source_event_id TEXT,
            source_inbox_id INTEGER,
            dispatch_member_id TEXT NOT NULL CHECK(length(trim(dispatch_member_id)) > 0),
            member_dispatch_sequence INTEGER NOT NULL CHECK(member_dispatch_sequence >= 1),
            depth INTEGER NOT NULL CHECK(depth >= 0),
            delivery_ordinal INTEGER NOT NULL CHECK(delivery_ordinal >= 1),
            request_digest TEXT NOT NULL
                CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
            dispatch_content TEXT NOT NULL CHECK(length(trim(dispatch_content)) > 0),
            display_content TEXT NOT NULL CHECK(length(trim(display_content)) > 0),
            images_json TEXT NOT NULL DEFAULT '[]'
                CHECK(json_valid(images_json)=1 AND json_type(images_json)='array'),
            status TEXT NOT NULL
                CHECK(status IN ('pending','started','completed','failed','cancelled','abandoned','unknown')),
            created_at TEXT NOT NULL,
            started_at TEXT,
            terminal_at TEXT,
            failure_reason TEXT,
            UNIQUE(session_id, turn_intent_id),
            UNIQUE(org_run_id, root_authority_turn_id, delivery_ordinal),
            FOREIGN KEY(org_run_id, root_authority_turn_id)
                REFERENCES agent_org_runtime_user_directed_roots(org_run_id, root_authority_turn_id)
                ON DELETE CASCADE,
            FOREIGN KEY(session_id, turn_intent_id)
                REFERENCES agent_org_runtime_turn_contexts(session_id, turn_intent_id)
                ON DELETE CASCADE,
            FOREIGN KEY(parent_delivery_id)
                REFERENCES agent_org_runtime_user_directed_deliveries(delivery_id) ON DELETE RESTRICT,
            FOREIGN KEY(source_inbox_id)
                REFERENCES agent_org_runtime_inbox(id) ON DELETE RESTRICT,
            FOREIGN KEY(parent_inbox_id)
                REFERENCES agent_org_runtime_inbox(id) ON DELETE RESTRICT,
            CHECK(
                (source_kind='direct_member'
                 AND source_event_id IS NOT NULL
                 AND source_inbox_id IS NULL AND parent_delivery_id IS NULL
                 AND parent_inbox_id IS NULL
                 AND depth=0 AND root_authority_turn_id=turn_intent_id)
                OR
                (source_kind='group_mention'
                 AND source_event_id IS NULL
                 AND source_inbox_id IS NOT NULL AND parent_delivery_id IS NULL
                 AND parent_inbox_id IS NULL
                 AND depth=0 AND root_authority_turn_id=turn_intent_id)
                OR
                (source_kind='member_inbox'
                 AND source_event_id IS NULL
                 AND source_inbox_id IS NOT NULL AND parent_delivery_id IS NOT NULL
                 AND depth>=1)
            ),
            CHECK(
                (status='pending' AND started_at IS NULL AND terminal_at IS NULL AND failure_reason IS NULL)
                OR
                (status='started' AND started_at IS NOT NULL AND terminal_at IS NULL AND failure_reason IS NULL)
                OR
                (status IN ('completed','cancelled') AND started_at IS NOT NULL AND terminal_at IS NOT NULL)
                OR
                (status IN ('failed','abandoned','unknown') AND terminal_at IS NOT NULL)
            )
        );

CREATE TABLE agent_org_runtime_user_directed_roots (
            org_run_id TEXT NOT NULL,
            root_authority_turn_id TEXT NOT NULL CHECK(length(trim(root_authority_turn_id)) > 0),
            policy_version INTEGER NOT NULL CHECK(policy_version >= 1),
            max_deliveries INTEGER NOT NULL CHECK(max_deliveries >= 1),
            max_cascade_depth INTEGER NOT NULL CHECK(max_cascade_depth >= 0),
            next_delivery_ordinal INTEGER NOT NULL CHECK(next_delivery_ordinal >= 2),
            created_at TEXT NOT NULL,
            PRIMARY KEY(org_run_id, root_authority_turn_id),
            FOREIGN KEY(org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_work_episode_tasks (
            org_run_id TEXT NOT NULL,
            work_episode_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            associated_at TEXT NOT NULL,
            PRIMARY KEY (org_run_id, task_id),
            FOREIGN KEY (work_episode_id)
                REFERENCES agent_org_runtime_work_episodes(id) ON DELETE CASCADE,
            FOREIGN KEY (org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            FOREIGN KEY (org_run_id, task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_runtime_work_episodes (
            id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            episode_sequence INTEGER NOT NULL CHECK(episode_sequence >= 1),
            status TEXT NOT NULL CHECK(status IN ('active','certified')),
            opening_activation_generation INTEGER NOT NULL
                CHECK(opening_activation_generation >= 1),
            closing_activation_generation INTEGER
                CHECK(closing_activation_generation IS NULL OR closing_activation_generation >= 1),
            opening_work_revision INTEGER NOT NULL CHECK(opening_work_revision >= 0),
            closing_work_revision INTEGER CHECK(closing_work_revision IS NULL OR closing_work_revision >= 0),
            outcome TEXT CHECK(outcome IN ('delivered','cancelled','failed')),
            certificate_id TEXT UNIQUE,
            opened_by_turn_intent_id TEXT NOT NULL CHECK(trim(opened_by_turn_intent_id) <> ''),
            created_at TEXT NOT NULL,
            closed_at TEXT,
            UNIQUE(org_run_id, episode_sequence),
            FOREIGN KEY (org_run_id) REFERENCES agent_org_runtime_runs(id) ON DELETE CASCADE,
            CHECK(
                (status='active' AND closing_activation_generation IS NULL
                    AND closing_work_revision IS NULL AND outcome IS NULL
                    AND certificate_id IS NULL AND closed_at IS NULL)
                OR
                (status='certified' AND closing_activation_generation IS NOT NULL
                    AND closing_work_revision IS NOT NULL AND outcome IS NOT NULL
                    AND certificate_id IS NOT NULL AND closed_at IS NOT NULL)
            )
        );

CREATE TABLE agent_org_scope_removal_receipts (
            receipt_id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            work_episode_id TEXT NOT NULL,
            target_task_id TEXT NOT NULL,
            root_user_event_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            request_digest TEXT NOT NULL,
            actor_session_id TEXT NOT NULL,
            actor_kind TEXT NOT NULL CHECK(actor_kind='run_view_user'),
            status TEXT NOT NULL CHECK(status IN ('recorded','revoked')),
            created_at TEXT NOT NULL,
            revoked_at TEXT,
            UNIQUE(org_run_id, request_id),
            UNIQUE(root_user_event_id),
            FOREIGN KEY(org_run_id, target_task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id) ON DELETE CASCADE,
            FOREIGN KEY(work_episode_id)
                REFERENCES agent_org_runtime_work_episodes(id) ON DELETE CASCADE
        );

CREATE TABLE agent_org_scope_resolution_receipts (
            resolution_id TEXT PRIMARY KEY,
            root_receipt_id TEXT NOT NULL,
            org_run_id TEXT NOT NULL,
            work_episode_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            resolution_kind TEXT NOT NULL CHECK(resolution_kind IN (
                'dependency_cancelled','dependency_replaced','dependency_detached'
            )),
            replacement_task_id TEXT,
            source_turn_intent_id TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(root_receipt_id,task_id,resolution_kind),
            FOREIGN KEY(root_receipt_id)
                REFERENCES agent_org_scope_removal_receipts(receipt_id) ON DELETE CASCADE,
            FOREIGN KEY(org_run_id,task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id,id) ON DELETE CASCADE,
            FOREIGN KEY(work_episode_id)
                REFERENCES agent_org_runtime_work_episodes(id) ON DELETE CASCADE,
            CHECK(
                (resolution_kind='dependency_replaced' AND replacement_task_id IS NOT NULL)
                OR (resolution_kind<>'dependency_replaced' AND replacement_task_id IS NULL)
            )
        );

CREATE TABLE agent_org_task_execution_leases (
            lease_id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            work_episode_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL CHECK(activation_generation >= 1),
            execution_epoch INTEGER NOT NULL CHECK(execution_epoch >= 1),
            owner_member_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            turn_intent_id TEXT NOT NULL,
            source_kind TEXT NOT NULL CHECK(source_kind IN (
                'assignment','plan_revision','coordinator_message',
                'pause_resume','intervention_return','legacy_repair'
            )),
            continuation_receipt_id TEXT NOT NULL,
            source_inbox_id INTEGER,
            prior_lease_id TEXT,
            state TEXT NOT NULL CHECK(state IN ('active','released','frozen','conflict')),
            terminal_reason_code TEXT,
            created_at TEXT NOT NULL,
            terminal_at TEXT,
            UNIQUE(session_id, turn_intent_id),
            UNIQUE(org_run_id, work_episode_id, task_id, activation_generation, execution_epoch),
            UNIQUE(continuation_receipt_id),
            FOREIGN KEY(org_run_id, task_id)
                REFERENCES agent_org_runtime_tasks(org_run_id, id) ON DELETE CASCADE,
            FOREIGN KEY(work_episode_id)
                REFERENCES agent_org_runtime_work_episodes(id) ON DELETE CASCADE,
            FOREIGN KEY(source_inbox_id)
                REFERENCES agent_org_runtime_inbox(id) ON DELETE SET NULL,
            FOREIGN KEY(prior_lease_id)
                REFERENCES agent_org_task_execution_leases(lease_id)
        );

CREATE TABLE agent_org_task_execution_reconciliations (
            context_id INTEGER PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            activation_generation INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            turn_intent_id TEXT NOT NULL,
            disposition TEXT NOT NULL CHECK(disposition='conflict_rejected'),
            reason_code TEXT NOT NULL CHECK(reason_code='duplicate_execution_rejected'),
            reconciled_at TEXT NOT NULL,
            UNIQUE(session_id,turn_intent_id),
            FOREIGN KEY(context_id)
                REFERENCES agent_org_runtime_turn_contexts(context_id) ON DELETE CASCADE
        );

CREATE UNIQUE INDEX idx_agent_org_completion_recheck_inbox
            ON agent_org_coordinator_completion_rechecks(inbox_id)
            WHERE inbox_id IS NOT NULL;

CREATE INDEX idx_agent_org_completion_recheck_pending
            ON agent_org_coordinator_completion_rechecks(org_run_id,status,work_revision);

CREATE UNIQUE INDEX idx_agent_org_final_summary_one_active
            ON agent_org_runtime_final_summary_receipts(certificate_id)
            WHERE status IN ('pending','running','persisting');

CREATE INDEX idx_agent_org_final_summary_public_timeline
            ON agent_org_runtime_final_summary_receipts(org_run_id,terminal_at,receipt_id)
            WHERE status IN ('persisted','failed');

CREATE INDEX idx_agent_org_final_summary_run_current
            ON agent_org_runtime_final_summary_receipts(
                org_run_id,activation_generation,attempt DESC
            );

CREATE UNIQUE INDEX idx_agent_org_final_summary_turn
            ON agent_org_runtime_final_summary_receipts(
                coordinator_session_id,turn_intent_id
            ) WHERE turn_intent_id IS NOT NULL;

CREATE INDEX idx_agent_org_formal_trigger_attempt_turn
            ON agent_org_runtime_formal_trigger_attempts(
                session_id,turn_intent_id,status,receipt_id
            );

CREATE INDEX idx_agent_org_formal_trigger_missing_doorbell
            ON agent_org_runtime_formal_trigger_receipts(
                doorbell_status,status,org_run_id,created_at
            ) WHERE status='pending' AND doorbell_status='missing';

CREATE UNIQUE INDEX idx_agent_org_formal_trigger_one_active_attempt
            ON agent_org_runtime_formal_trigger_attempts(receipt_id)
            WHERE status IN ('queued','running');

CREATE INDEX idx_agent_org_formal_trigger_pending
            ON agent_org_runtime_formal_trigger_receipts(
                org_run_id,status,doorbell_status,created_at,receipt_id
            );

CREATE INDEX idx_agent_org_formal_trigger_task
            ON agent_org_runtime_formal_trigger_receipts(org_run_id,task_id,created_at)
            WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX idx_agent_org_member_intervention_active
            ON agent_org_runtime_member_interventions(org_run_id, member_id)
            WHERE status IN ('yield_requested','active','return_requested');

CREATE UNIQUE INDEX idx_agent_org_member_intervention_continuation
            ON agent_org_runtime_member_interventions(session_id, continuation_turn_intent_id)
            WHERE continuation_turn_intent_id IS NOT NULL;

CREATE INDEX idx_agent_org_member_intervention_public_timeline
            ON agent_org_runtime_member_interventions(
                org_run_id,cleared_at,intervention_receipt_id
            ) WHERE status='cleared';

CREATE UNIQUE INDEX idx_agent_org_member_intervention_return_request
            ON agent_org_runtime_member_interventions(org_run_id, return_request_id)
            WHERE return_request_id IS NOT NULL;

CREATE INDEX idx_agent_org_member_intervention_session
            ON agent_org_runtime_member_interventions(session_id, status, updated_at);

CREATE INDEX idx_agent_org_member_intervention_turn_queue
            ON agent_org_runtime_member_intervention_turns(
                intervention_receipt_id, status, member_dispatch_sequence
            );

CREATE INDEX idx_agent_org_member_turn_admission_recovery
            ON agent_org_member_turn_admissions(status, updated_at);

CREATE INDEX idx_agent_org_runtime_archive_pending
            ON agent_org_runtime_archive_episodes(teardown_status, deadline_at);

CREATE INDEX idx_agent_org_runtime_archive_teardown_pending
            ON agent_org_runtime_archive_teardowns(
                archive_receipt_id, teardown_status, session_id
            );

CREATE UNIQUE INDEX idx_agent_org_runtime_inbox_causation_recipient_once
            ON agent_org_runtime_inbox(
                causation_inbox_id,
                payload_kind,
                recipient_agent_id,
                COALESCE(recipient_member_id, '')
            )
            WHERE causation_inbox_id IS NOT NULL;

CREATE INDEX idx_agent_org_runtime_inbox_delivery_resolutions_run
            ON agent_org_runtime_inbox_delivery_resolutions(org_run_id, inbox_id);

CREATE INDEX idx_agent_org_runtime_inbox_materializations_session
            ON agent_org_runtime_inbox_materializations(session_id, inbox_id);

CREATE INDEX idx_agent_org_runtime_inbox_org_run
            ON agent_org_runtime_inbox(org_run_id, created_at);

CREATE INDEX idx_agent_org_runtime_inbox_org_run_id
            ON agent_org_runtime_inbox(org_run_id, id);

CREATE INDEX idx_agent_org_runtime_inbox_recipient_member_unread
            ON agent_org_runtime_inbox(recipient_member_id, read_at, created_at);

CREATE INDEX idx_agent_org_runtime_inbox_recipient_unread
            ON agent_org_runtime_inbox(recipient_agent_id, read_at, created_at);

CREATE INDEX idx_agent_org_runtime_inbox_request_id
            ON agent_org_runtime_inbox(request_id);

CREATE INDEX idx_agent_org_runtime_inbox_run_kind_id
            ON agent_org_runtime_inbox(org_run_id, payload_kind, id);

CREATE INDEX idx_agent_org_runtime_inbox_run_task_assignment_v4
            ON agent_org_runtime_inbox(
                org_run_id,
                recipient_member_id,
                json_extract(
                    CASE WHEN length(CAST(payload_json AS BLOB))<=262144
                                   AND json_valid(payload_json)
                         THEN payload_json ELSE '{}' END,
                    '$.task_id'
                )
            )
            WHERE payload_kind='task_assigned'
              AND CASE WHEN length(CAST(payload_json AS BLOB))<=262144
                       THEN json_valid(payload_json) ELSE 0 END
              AND json_type(
                    CASE WHEN length(CAST(payload_json AS BLOB))<=262144
                                   AND json_valid(payload_json)
                         THEN payload_json ELSE '{}' END,
                    '$.task_id'
                  )='text';

CREATE INDEX idx_agent_org_runtime_inbox_run_unread_recipient
            ON agent_org_runtime_inbox(org_run_id, recipient_member_id, recipient_agent_id, id)
            WHERE read_at IS NULL;

CREATE INDEX idx_agent_org_runtime_inbox_task_bindings_wake
            ON agent_org_runtime_inbox_task_bindings(
                org_run_id,recipient_member_id,task_id,inbox_id
            );

CREATE UNIQUE INDEX idx_agent_org_runtime_inbox_user_message_once
            ON agent_org_runtime_inbox(org_run_id, sender_agent_id, client_message_id)
            WHERE client_message_id IS NOT NULL;

CREATE INDEX idx_agent_org_runtime_initial_inputs_dispatch
            ON agent_org_runtime_initial_inputs(status, org_run_id);

CREATE INDEX idx_agent_org_runtime_member_materializations_pending
            ON agent_org_runtime_member_materializations(status, org_run_id, generation);

CREATE INDEX idx_agent_org_runtime_pause_capture
            ON agent_org_runtime_turn_contexts(
                org_run_id, activation_generation, turn_kind, session_id, turn_intent_id
            )
            WHERE turn_kind IN ('coordinator','task_execution');

CREATE INDEX idx_agent_org_runtime_pause_dispatch
            ON agent_org_runtime_pause_handoffs(continuation_status, org_run_id, session_id);

CREATE INDEX idx_agent_org_runtime_pause_drain
            ON agent_org_runtime_pause_handoffs(episode_id, drain_status, session_id);

CREATE UNIQUE INDEX idx_agent_org_runtime_pause_one_active
            ON agent_org_runtime_pause_episodes(org_run_id)
            WHERE status='active';

CREATE INDEX idx_agent_org_runtime_pause_public_timeline
            ON agent_org_runtime_pause_episodes(org_run_id, created_at, episode_id);

CREATE INDEX idx_agent_org_runtime_pause_request
            ON agent_org_runtime_pause_episodes(org_run_id, pause_request_id);

CREATE INDEX idx_agent_org_runtime_plan_decisions_status
            ON agent_org_runtime_plan_decisions(status, created_at, approval_id);

CREATE INDEX idx_agent_org_runtime_plan_revisions_path
            ON agent_org_runtime_plan_revisions(plan_path, created_at DESC);

CREATE INDEX idx_agent_org_runtime_plan_revisions_run_task
            ON agent_org_runtime_plan_revisions(
                org_run_id, source_task_id, revision_number DESC
            );

CREATE INDEX idx_agent_org_runtime_plan_revisions_source_session_turn
            ON agent_org_runtime_plan_revisions(
                source_session_id, source_turn_intent_id, created_at
            );

CREATE INDEX idx_agent_org_runtime_recovery_attempts_run
            ON agent_org_runtime_recovery_attempts(org_run_id);

CREATE INDEX idx_agent_org_runtime_resume_public_timeline
            ON agent_org_runtime_pause_episodes(org_run_id, resumed_at, episode_id)
            WHERE resumed_at IS NOT NULL;

CREATE INDEX idx_agent_org_runtime_run_completion_certificates_turn
            ON agent_org_runtime_run_completion_certificates(
                coordinator_session_id,coordinator_turn_intent_id
            );

CREATE INDEX idx_agent_org_runtime_run_completion_public_timeline
            ON agent_org_runtime_run_completion_certificates(org_run_id,created_at,id);

CREATE INDEX idx_agent_org_runtime_runs_org_updated
            ON agent_org_runtime_runs(org_id, updated_at);

CREATE INDEX idx_agent_org_runtime_runs_root_session
            ON agent_org_runtime_runs(root_session_id);

CREATE INDEX idx_agent_org_runtime_runs_status
            ON agent_org_runtime_runs(status);

CREATE INDEX idx_agent_org_runtime_runs_work_item
            ON agent_org_runtime_runs(work_item_id);

CREATE INDEX idx_agent_org_runtime_task_annotations_page
            ON agent_org_runtime_task_annotations(org_run_id, task_id, created_at, id);

CREATE INDEX idx_agent_org_runtime_task_events_run
            ON agent_org_runtime_task_events(org_run_id, created_at, id);

CREATE INDEX idx_agent_org_runtime_task_events_task
            ON agent_org_runtime_task_events(org_run_id, task_id, created_at, id);

CREATE UNIQUE INDEX idx_agent_org_runtime_task_execution_handoffs_replacement
            ON agent_org_runtime_task_execution_handoffs(org_run_id, replacement_task_id)
            WHERE replacement_task_id IS NOT NULL;

CREATE INDEX idx_agent_org_runtime_task_execution_handoffs_run
            ON agent_org_runtime_task_execution_handoffs(org_run_id, activation_generation, state, requested_at, id);

CREATE INDEX idx_agent_org_runtime_tasks_history_page
         ON agent_org_runtime_tasks(org_run_id, status, updated_at, id);

CREATE INDEX idx_agent_org_runtime_tasks_owner
            ON agent_org_runtime_tasks(org_run_id, owner, status);

CREATE INDEX idx_agent_org_runtime_tasks_page
            ON agent_org_runtime_tasks(org_run_id, status, created_at, id);

CREATE INDEX idx_agent_org_runtime_tasks_replacement
            ON agent_org_runtime_tasks(org_run_id, replaces_task_id);

CREATE INDEX idx_agent_org_runtime_turn_contexts_group_root_session
            ON agent_org_runtime_turn_contexts(session_id, context_id, source_id)
            WHERE source_kind='group_root';

CREATE UNIQUE INDEX idx_agent_org_runtime_turn_contexts_member_sequence
            ON agent_org_runtime_turn_contexts(
                org_run_id, dispatch_member_id, member_dispatch_sequence
            )
            WHERE dispatch_member_id IS NOT NULL;

CREATE INDEX idx_agent_org_runtime_turn_contexts_public_timeline
            ON agent_org_runtime_turn_contexts(org_run_id, created_at, context_id)
            WHERE source_kind IN ('group_root','group_mention');

CREATE INDEX idx_agent_org_runtime_turn_contexts_source
            ON agent_org_runtime_turn_contexts(
                org_run_id, source_kind, source_id, context_id
            );

CREATE INDEX idx_agent_org_runtime_udw_coordinator_pending
            ON agent_org_runtime_user_directed_coordinator_bindings(binding_id)
            WHERE status='pending';

CREATE INDEX idx_agent_org_runtime_udw_member_fifo
            ON agent_org_runtime_user_directed_deliveries(
                org_run_id, dispatch_member_id, member_dispatch_sequence
            ) WHERE status IN ('pending','started');

CREATE INDEX idx_agent_org_runtime_udw_pending_recovery
            ON agent_org_runtime_user_directed_deliveries(delivery_id)
            WHERE status='pending';

CREATE UNIQUE INDEX idx_agent_org_runtime_udw_source_inbox
            ON agent_org_runtime_user_directed_deliveries(source_inbox_id)
            WHERE source_inbox_id IS NOT NULL;

CREATE INDEX idx_agent_org_runtime_work_episode_tasks_episode
            ON agent_org_runtime_work_episode_tasks(org_run_id, work_episode_id, task_id);

CREATE UNIQUE INDEX idx_agent_org_runtime_work_episodes_active
            ON agent_org_runtime_work_episodes(org_run_id) WHERE status='active';

CREATE INDEX idx_agent_org_runtime_work_episodes_current
            ON agent_org_runtime_work_episodes(org_run_id, episode_sequence DESC);

CREATE INDEX idx_agent_org_scope_removal_episode
            ON agent_org_scope_removal_receipts(org_run_id,work_episode_id,target_task_id);

CREATE INDEX idx_agent_org_scope_resolution_episode
            ON agent_org_scope_resolution_receipts(org_run_id,work_episode_id,task_id);

CREATE UNIQUE INDEX idx_agent_org_task_execution_one_live
            ON agent_org_task_execution_leases(
                org_run_id,work_episode_id,task_id,activation_generation
            ) WHERE state='active';

CREATE INDEX idx_agent_org_task_execution_reconciliation_task
            ON agent_org_task_execution_reconciliations(
                org_run_id,task_id,activation_generation
            );

CREATE INDEX idx_agent_org_task_execution_task
            ON agent_org_task_execution_leases(org_run_id,task_id,execution_epoch DESC);

CREATE INDEX idx_agent_org_task_execution_turn
            ON agent_org_task_execution_leases(session_id,turn_intent_id,state);

CREATE TRIGGER trg_agent_org_runtime_plan_revisions_immutable
        BEFORE UPDATE ON agent_org_runtime_plan_revisions
        BEGIN
            SELECT RAISE(ABORT, 'agent_org_plan_revision_immutable');
        END;
