const mirrorNames = new Set([
  "sessionRuntimeStatusAtom",
  "isSessionActiveAtom",
  "isSessionEngineActiveAtom",
  "isPendingCancelAtom",
]);
const queueOwners =
  /(?:^|\/)src\/engines\/SessionCore\/(?:hooks\/session\/useQueueDispatch|derived\/queueDispatchSyncInputsAtom)\.ts$/;

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Keep queue dispatch decisions on the turn lifecycle FSM",
    },
    schema: [],
    messages: {
      mirror:
        "Queue dispatch must use getTurnPhase/turnLifecycleSignalAtom, not the {{name}} UI status mirror.",
    },
  },
  create(context) {
    if (!queueOwners.test(context.getFilename().replace(/\\/g, "/"))) return {};
    const namespaces = new Set();
    const report = (node, name) =>
      context.report({ node, messageId: "mirror", data: { name } });
    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            const name = specifier.imported.name ?? specifier.imported.value;
            if (mirrorNames.has(name)) report(specifier, name);
          } else if (
            specifier.type === "ImportNamespaceSpecifier" &&
            /(?:^@src\/store\/session(?:\/|$)|cliSessionStatusAtom(?:\.ts)?$)/.test(
              node.source.value
            )
          ) {
            namespaces.add(specifier.local.name);
          }
        }
      },
      MemberExpression(node) {
        if (
          node.object.type !== "Identifier" ||
          !namespaces.has(node.object.name)
        )
          return;
        const name = node.computed ? node.property.value : node.property.name;
        if (mirrorNames.has(name)) report(node, name);
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== "ObjectPattern" ||
          node.init?.type !== "Identifier" ||
          !namespaces.has(node.init.name)
        )
          return;
        for (const prop of node.id.properties) {
          if (prop.type !== "Property") continue;
          const name = prop.key.name ?? prop.key.value;
          if (mirrorNames.has(name)) report(prop, name);
        }
      },
    };
  },
};
