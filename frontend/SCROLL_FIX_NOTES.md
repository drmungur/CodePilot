# V8.3.3 scroll repair

The page is intentionally kept in normal document flow.
- html owns vertical scrolling
- body/root cannot become scroll containers
- decorative canvas is pointer-events:none
- global wheel/touch preventDefault handlers are removed if present
- smooth scrolling is enabled with reduced-motion fallback
