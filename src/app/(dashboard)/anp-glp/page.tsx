import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

/**
 * /anp-glp — desktop-only by CTO decision (reference data, sporadic use).
 * Mobile visitors are redirected to /home via MobileExcludedRedirect.
 */
export default function AnpGlpPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="anp-glp" />
      <DesktopView />
    </>
  );
}
