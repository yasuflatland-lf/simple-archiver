//! Loom nucleus for the worker-message aggregation path.

use std::path::PathBuf;
use std::time::Instant;

use loom::sync::mpsc;
use loom::thread;

use crate::application::progress_aggregator::{Aggregator, WorkerMsg};
use crate::domain::archive_job::ArchiveJob;
use crate::domain::archive_task::TaskId;
use crate::domain::naming_rule::NamingRule;
use crate::domain::output_directory::OutputDirectory;
use crate::domain::source_item::SourceItem;
use crate::domain::task_progress::TaskProgress;
use crate::domain::task_status::TaskEvent;

/// Messages the success worker emits: StartCompressing + Progress + Complete.
const SUCCESS_MSGS: usize = 3;
/// Messages the cancel worker emits: StartCompressing + Cancel.
const CANCEL_MSGS: usize = 2;
/// Messages the failure worker emits: Fail.
const FAILURE_MSGS: usize = 1;

#[allow(dead_code)]
pub(crate) fn model_terminal_messages_are_not_lost() {
    loom::model(|| {
        let job = folder_job(3);
        let ids: Vec<TaskId> = job.tasks().iter().map(|task| task.id()).collect();
        let started_at = Instant::now();

        let (tx, rx) = mpsc::channel::<WorkerMsg>();

        let success_tx = tx.clone();
        let success_task = ids[0];
        let success = thread::spawn(move || {
            success_tx
                .send(WorkerMsg::Status {
                    task: success_task,
                    event: TaskEvent::StartCompressing,
                })
                .expect("aggregator receiver should be alive");
            success_tx
                .send(WorkerMsg::Progress {
                    task: success_task,
                    progress: TaskProgress::new(1, 1),
                })
                .expect("aggregator receiver should be alive");
            success_tx
                .send(WorkerMsg::Status {
                    task: success_task,
                    event: TaskEvent::Complete,
                })
                .expect("aggregator receiver should be alive");
        });

        let cancel_tx = tx.clone();
        let cancel_task = ids[1];
        let cancelled = thread::spawn(move || {
            cancel_tx
                .send(WorkerMsg::Status {
                    task: cancel_task,
                    event: TaskEvent::StartCompressing,
                })
                .expect("aggregator receiver should be alive");
            cancel_tx
                .send(WorkerMsg::Status {
                    task: cancel_task,
                    event: TaskEvent::Cancel,
                })
                .expect("aggregator receiver should be alive");
        });

        let failure_tx = tx.clone();
        let failure_task = ids[2];
        let failed = thread::spawn(move || {
            failure_tx
                .send(WorkerMsg::Status {
                    task: failure_task,
                    event: TaskEvent::Fail {
                        reason: "boom".to_string(),
                    },
                })
                .expect("aggregator receiver should be alive");
        });

        drop(tx);

        let mut aggregator = Aggregator::new(job, started_at);
        // NOTE: loom's `mpsc` (loom 0.7) models a channel as a bare message count
        // (`rt::Channel` tracks only `msg_cnt`); it has NO notion of "all senders
        // dropped", so `recv()` BLOCKS forever on an empty channel instead of
        // returning `Err(RecvError)` — a `while let Ok(_) = rx.recv()` drain-to-
        // closure deadlocks under loom. We therefore drain exactly the messages
        // the workers above are defined to emit. The count is derived from those
        // worker bodies (success: Start+Progress+Complete = 3, cancel: Start+Cancel
        // = 2, failure: Fail = 1) rather than a magic literal, so it stays honest
        // as the worker set changes, while loom still verifies that EVERY emitted
        // message is received before `into_summary` finalizes (no message lost).
        let expected_messages = SUCCESS_MSGS + CANCEL_MSGS + FAILURE_MSGS;
        for _ in 0..expected_messages {
            let msg = rx.recv().expect("worker message should not be lost");
            aggregator
                .apply(msg)
                .expect("each worker preserves per-task state ordering");
            assert_eq!(aggregator.snapshot(started_at).per_task.len(), ids.len());
        }

        success.join().expect("success worker should not panic");
        cancelled.join().expect("cancel worker should not panic");
        failed.join().expect("failure worker should not panic");

        let summary = aggregator.into_summary();
        assert_eq!(summary.succeeded, vec![ids[0]]);
        assert_eq!(summary.cancelled, vec![ids[1]]);
        assert_eq!(summary.failed, vec![(ids[2], "boom".to_string())]);
    });
}

fn folder_job(n: usize) -> ArchiveJob {
    let items = (0..n)
        .map(|i| SourceItem::Folder(PathBuf::from(format!("dir{i}"))))
        .collect();
    ArchiveJob::plan(
        items,
        NamingRule::parse("f{n}").unwrap(),
        OutputDirectory::new(PathBuf::from("/out")),
    )
    .unwrap()
}

#[cfg(test)]
mod tests {
    #[test]
    fn terminal_worker_messages_are_aggregated_without_loss() {
        super::model_terminal_messages_are_not_lost();
    }
}
