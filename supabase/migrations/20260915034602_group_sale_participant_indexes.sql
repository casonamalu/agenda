create index appointment_participants_outcome_by_idx
  on public.appointment_participants(commercial_outcome_by)
  where commercial_outcome_by is not null;

create index appointment_participants_order_idx
  on public.appointment_participants(order_id)
  where order_id is not null;

create index appointment_participants_created_by_idx
  on public.appointment_participants(created_by);

create index appointment_participants_updated_by_idx
  on public.appointment_participants(updated_by);

create index participant_decision_history_changed_by_idx
  on public.appointment_participant_decision_history(changed_by)
  where changed_by is not null;
