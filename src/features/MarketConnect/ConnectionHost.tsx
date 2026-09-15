import { Suspense, lazy, useEffect, useState } from "react";

import { type Connection, connectionSchema } from "./rpc";

const SellerDialog = lazy(() => import("./SellerDialog"));
const ConnectionDialog = lazy(() => import("./ConnectionDialog"));
const Org2SessionDialog = lazy(() => import("./Org2SessionDialog"));
export default function ConnectionHost() {
  const [connection, setConnection] = useState<Connection | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const value = connectionSchema.safeParse((event as CustomEvent).detail);
      if (value.success) setConnection(value.data);
    };
    window.addEventListener("market-authorization-saved", open);
    window.addEventListener("market-connection-open", open);
    return () => {
      window.removeEventListener("market-authorization-saved", open);
      window.removeEventListener("market-connection-open", open);
    };
  }, []);
  const Dialog =
    connection?.target === "org2" ? Org2SessionDialog : ConnectionDialog;
  return (
    <>
      {" "}
      <Suspense fallback={null}>
        <SellerDialog />
      </Suspense>
      {connection ? (
        <Suspense fallback={null}>
          <Dialog
            key={`${connection.identity_user_id}:${connection.workspace_id}:${connection.target}`}
            connection={connection}
            onClose={() => setConnection(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
