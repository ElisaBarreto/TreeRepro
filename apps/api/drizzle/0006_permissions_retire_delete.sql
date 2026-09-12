-- RFC-30 R1: a retired key keeps its row; RFC-50 R12: users are never erased.
UPDATE permissions SET description = 'Erase users (retired)' WHERE key = 'users.delete';
