# SQL editor pastes

The full schema is `../schema.sql`. Chat dumps of that file get truncated
inside a function body and fail with `unterminated dollar-quoted string`.

Copy each file here with GitHub **Raw**, then run in order:

1. `01-core.sql`
2. `02-remainder.sql`

Each file ends on a complete statement. Discard a failed query and do not
run `ALTER TABLE rec ENABLE ROW LEVEL SECURITY`.
