import type { GitFile } from "@src/types/git/types";

export interface GitFileTreeNode {
  type: "file" | "directory";
  name: string;
  path: string;
  file?: GitFile;
  children?: GitFileTreeNode[];
  expanded?: boolean;
  /** Aggregate status for folders (highest priority status of children) */
  aggregateStatus?: GitFile["status"];
}
