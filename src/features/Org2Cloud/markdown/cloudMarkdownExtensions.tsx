/**
 * Org2Cloud's Markdown renderer extensions.
 *
 * Cloud session references and shared-session file references are an ORG2
 * Cloud grammar, not a Markdown one. The renderer used to parse them by
 * importing this feature; it now declares slots and this module fills them:
 *
 * - `remarkPlugins`   — linkify bare `orgii://…` references in plain text
 * - `ownsReferenceHref` — keep those schemes past react-markdown's sanitizer
 * - `renderReferenceLink` — render the two reference link flavours
 * - `sessionAttachments` — project references out of prose into cards
 *
 * Side-effect free to import: `src/app/root` calls the export below.
 */
import React from "react";

import type {
  MarkdownAttachmentProjection,
  MarkdownExtensions,
} from "@src/components/MarkDown/extensions";

import SharedSessionFileLink from "../SharedSessionFileLink";
import {
  type CloudSessionReference,
  parseCloudSessionReference,
} from "../cloudSessionReference";
import { parseSharedSessionFileReference } from "../sharedSessionFileReference";
import { useOpenCloudSessionReference } from "../useOpenCloudSessionReference";
import SessionReferenceCards from "./SessionReferenceCards";
import { remarkCloudSessionReferences } from "./remarkCloudSessionReferences";
import {
  type MarkdownSessionReference,
  projectMarkdownSessionReferences,
} from "./sessionReferenceProjection";

const CloudSessionMarkdownLink: React.FC<{
  href: string;
  children: React.ReactNode;
  reference: CloudSessionReference;
}> = ({ href, children, reference }) => {
  const openReference = useOpenCloudSessionReference();
  return (
    <a
      href={href}
      title={undefined}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openReference(reference, { autoReplay: true });
      }}
    >
      {children}
    </a>
  );
};
CloudSessionMarkdownLink.displayName = "CloudSessionMarkdownLink";

function ownsReferenceHref(href: string): boolean {
  return (
    parseSharedSessionFileReference(href) !== null ||
    parseCloudSessionReference(href) !== null
  );
}

function renderReferenceLink(
  href: string,
  children: React.ReactNode
): React.ReactNode | null {
  const sharedFile = parseSharedSessionFileReference(href);
  if (sharedFile)
    return (
      <SharedSessionFileLink href={href} reference={sharedFile}>
        {children}
      </SharedSessionFileLink>
    );
  const cloudReference = parseCloudSessionReference(href);
  if (cloudReference)
    return (
      <CloudSessionMarkdownLink href={href} reference={cloudReference}>
        {children}
      </CloudSessionMarkdownLink>
    );
  return null;
}

function project(source: string): MarkdownAttachmentProjection {
  const { text, references, referenceOnly } =
    projectMarkdownSessionReferences(source);
  return { text, attachments: references, referenceOnly };
}

/**
 * The renderer treats attachments as opaque payloads; they only ever travel
 * from `project` back into `render`, both owned here, so this is the single
 * point where the domain type is reasserted.
 */
function render(attachments: readonly unknown[]): React.ReactNode {
  return (
    <SessionReferenceCards
      references={attachments as readonly MarkdownSessionReference[]}
    />
  );
}

export const org2CloudMarkdownExtensions: MarkdownExtensions = {
  remarkPlugins: [remarkCloudSessionReferences],
  ownsReferenceHref,
  renderReferenceLink,
  sessionAttachments: { project, render },
};
