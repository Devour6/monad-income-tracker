/**
 * /reports has been merged into the validator detail page.
 * Pick a validator on the home page; date range, FX toggle, CSV/PDF export
 * are all inline on that page.
 */
import { redirect } from "next/navigation";

export default function ReportsRedirect(): never {
  redirect("/");
}
