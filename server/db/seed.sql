-- Root node
INSERT INTO nodes (id, parent_id, label, description, why, color) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Idea Basin', 'The root of everything.', NULL, '#7c3aed');

-- Example starter nodes (feel free to modify or delete these)
INSERT INTO nodes (id, parent_id, label, description, why, color) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Projects', 'Active projects and their sub-tasks.', 'So nothing falls through the cracks.', '#f97316'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'Research', 'Papers, articles, and references.', 'Understanding what matters.', '#22d3ee'),
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'Ideas', 'Half-formed thoughts and sparks.', 'So they have somewhere to go.', '#4ade80'),
  ('00000000-0000-0000-0000-000000000080', '00000000-0000-0000-0000-000000000001', 'Artifacts', 'Documents, summaries, and code created by the chat assistant.', 'So generated content has a home.', '#ffffff');
