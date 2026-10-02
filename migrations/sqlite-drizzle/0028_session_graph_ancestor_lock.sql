CREATE TABLE `session_graph_ancestor_lock` (
	`message_id` text PRIMARY KEY NOT NULL,
	`locked_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
WITH RECURSIVE shared_path(id) AS (
  SELECT message_id
  FROM session_graph_message_copy
  WHERE graph_message_id IN (
    SELECT graph_message_id FROM session_graph_message_copy
    GROUP BY graph_message_id HAVING COUNT(*) > 1
  )
  UNION
  SELECT m.parent_id FROM message m JOIN shared_path p ON m.id = p.id
  WHERE m.parent_id IS NOT NULL
)
INSERT INTO session_graph_ancestor_lock (message_id, locked_at)
SELECT m.id, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM message m JOIN shared_path p ON m.id = p.id
WHERE m.role <> 'root';
