import { permanentRedirect } from "next/navigation";

export default function Page() {
  permanentRedirect("/market-share?unit=volume");
}
