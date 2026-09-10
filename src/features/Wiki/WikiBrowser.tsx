import { useState } from "react";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { SESSION_ROW_PRESENTATION } from "@src/components/SessionRowPresentation";
import { SIDEBAR_STYLE } from "@src/scaffold/NavigationSidebar/config";

import { searchWikiArticles } from "./wikiArticles";

export default function WikiBrowser() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("keys");
  const results = searchWikiArticles(query);
  const article =
    results.find((entry) => entry.id === selectedId) ?? results[0];
  return (
    <section
      lang="en"
      aria-label="Feature wiki"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav
          aria-label="Wiki articles"
          className="flex w-44 shrink-0 flex-col gap-1 border-r border-border-2 px-3 py-2 sm:w-60"
        >
          <div className="flex shrink-0 flex-col gap-2 pb-3">
            <Input
              type="search"
              aria-label="Search the wiki"
              placeholder="Search wiki…"
              value={query}
              onChange={setQuery}
              allowClear
            />
          </div>
          {results.map((entry) => (
            <button
              type="button"
              key={entry.id}
              aria-current={article?.id === entry.id ? "page" : undefined}
              onClick={() => setSelectedId(entry.id)}
              title={`${entry.category}: ${entry.title}`}
              style={{ height: SIDEBAR_STYLE.rowHeight }}
              className={`${SESSION_ROW_PRESENTATION.row} shrink-0 px-2 text-left text-text-1 hover:bg-sidebar-selected focus-visible:outline focus-visible:outline-primary-6 ${article?.id === entry.id ? "bg-sidebar-selected" : ""}`}
              data-testid={`wiki-${entry.id}`}
            >
              <span className={SESSION_ROW_PRESENTATION.title}>
                {entry.title}
              </span>
            </button>
          ))}
        </nav>
        <div
          key={article?.id ?? "empty"}
          role="region"
          aria-label="Wiki article content"
          tabIndex={0}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4"
        >
          {article ? (
            <article
              aria-labelledby="wiki-article-title"
              className="flex min-w-0 flex-col gap-4"
            >
              <div>
                <p className="text-xs text-text-3">{article.category}</p>
                <h2
                  id="wiki-article-title"
                  className="text-lg font-semibold text-text-1"
                >
                  {article.title}
                </h2>
              </div>
              <p className="text-sm text-text-2">{article.summary}</p>
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-text-2">
                {article.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-text-2">
                No articles match “{query}”. Try a provider name, “keys” or
                “imports”.
              </p>
              <Button onClick={() => setQuery("")}>Clear search</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
