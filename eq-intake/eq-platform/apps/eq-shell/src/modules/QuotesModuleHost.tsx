import { QuotesModule } from "./quotes/QuotesModule.js";
import { getSupabase } from "../auth/supabase-client.js";

export function QuotesModuleHost(): JSX.Element {
  const supabase = getSupabase();
  return <QuotesModule supabase={supabase} />;
}
