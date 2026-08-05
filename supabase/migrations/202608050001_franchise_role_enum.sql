-- Khana Banao CRM: introduce the Franchise tier between Director and Manager.
--
-- PostgreSQL cannot use a new enum label in the same transaction that adds it,
-- so the label is added on its own and every object that references it lives in
-- the following migration.

alter type public.profile_role add value if not exists 'franchise' after 'director';
