import { useAtomValue } from "jotai";

import { SESSION_CONFIG } from "@src/config/sessionCreatorConfig";
import FindCard from "@src/scaffold/GlobalSpotlight/FindCard";
import { sessionByIdAtom } from "@src/store/session";
import { stripPillReferences } from "@src/util/session/stripPillReferences";

import type { UseChatSearchReturn } from "../hooks/useChatSearch";

export interface ChatSearchBarProps {
  search: UseChatSearchReturn;
  sessionId: string | null;
}
export default function ChatSearchBar({
  search,
  sessionId,
}: ChatSearchBarProps) {
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const name =
    session?.name && session.name !== SESSION_CONFIG.DEFAULT_SESSION_NAME
      ? session.name
      : stripPillReferences(session?.user_input || "");
  return <FindCard search={search} scope="session" targetName={name} />;
}
