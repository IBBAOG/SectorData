-- Hardening B: pin search_path on alerts_clear_token_on_confirm trigger function
-- Addresses get_advisors WARN `function_search_path_mutable` after alerts schema landed
ALTER FUNCTION public.alerts_clear_token_on_confirm() SET search_path = public;
