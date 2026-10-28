import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderReport(target: HTMLElement, text: string) {
  target.classList.add("report-body");
  target.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "code", "strong", "em", "del", "ul", "ol", "li", "blockquote", "a", "br", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    ALLOWED_ATTR: ["href", "title"],
  });
}
