//! Domain layer — pure business logic, no IO.
//! Naming rules, sequence numbers, output-filename value objects (PR3, issue #3),
//! and the ArchiveJob aggregate with reordering (PR4, issue #4).

pub mod archive_format;
pub mod archive_job;
pub mod archive_task;
pub mod conflict_policy;
pub mod file_name;
pub mod naming_rule;
pub mod output_directory;
pub mod output_mode;
pub mod sequence_number;
pub mod source_item;
pub mod task_progress;
pub mod task_status;
