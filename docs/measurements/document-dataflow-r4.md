# R4 verification

Recovery scheduling now keeps the timestamp and request ID from the first dirty
revision until storage confirms a checkpoint. Revisions that arrive during an
in-flight write update the requested target instead of disappearing. The state
tracks requested, captured, queued, confirmed, and failed revisions separately.

An unchanged dirty revision gets three bounded retries after 250, 750, and
1,500 milliseconds. A new edit resets the retry count but keeps the original
outstanding deadline. Failure stays on the affected document. A successful
checkpoint for another document does not clear that buffer's error. If native
storage confirms after 2,000 milliseconds, Amanite records the measured lag and
shows a per-document warning even though the draft succeeded.

Snapshot caching from R2 lets recovery and autosave reuse the same completed
revision without another HTML export. The project draft queue serializes write,
move, cleanup, and deletion. A queued newer write or delete supersedes an older
write before it reaches native storage.

Frontend tests cover continuous revisions reaching the original max-lag timer,
an unchanged revision succeeding after transient failure, obsolete snapshots,
and queue supersession. Rust tests write and atomically replace a real draft,
verify the latest complete JSON record, and verify that the temporary file is
gone after success. The desktop smoke test force-kills Amanite after a confirmed
native draft and restores it after restart.

The Linux write path syncs the temporary file before rename and attempts a
directory sync after rename. Directory sync is best effort. This supports a
process-crash claim after successful command completion, not a blanket
power-loss guarantee. Termination at each internal write stage, Windows
replacement behavior, and a separate power-loss test remain unverified and are
listed in R7.
