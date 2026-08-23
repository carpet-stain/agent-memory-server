-- ADR-0033's semantic pointer graph. One database per agent (ADR-0046 v1
-- isolation model) — no role/tenant column, the database boundary is the
-- isolation boundary.
--
-- No foreign key from relations to entities: plan-review round 2 accepted
-- this as matching the reference server's own behavior (create_relations and
-- delete_entities are separate calls under the same store-level lock, not one
-- transaction with each other) — a relation can dangle after its entity is
-- deleted. Callers that care check for it; the store doesn't enforce it.

create table if not exists entities (
    name text primary key,
    entity_type text not null,
    observations text[] not null default '{}'
);

-- Named + re-applied every run (drop/add, not inline on the column): the
-- constraint's allowed set has already changed once (repo-map, #634) and
-- `create table if not exists` no-ops against an existing table, so an
-- inline check would silently stop tracking edits to this list.
alter table entities drop constraint if exists entities_entity_type_check;
alter table entities add constraint entities_entity_type_check
    check (entity_type in ('project', 'reference', 'user', 'feedback', 'repo-map'));

create table if not exists relations (
    from_entity text not null,
    to_entity text not null,
    relation_type text not null,
    primary key (from_entity, to_entity, relation_type)
);

create index if not exists relations_from_entity_idx on relations (from_entity);
create index if not exists relations_to_entity_idx on relations (to_entity);
