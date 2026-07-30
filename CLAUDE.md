# Global instructions

## Graphify

If `graphify-out/graph.json` exists: query graph first for codebase navigation, structure, dependencies. No grep, no full-file reads for discovery. Graph missing or stale → suggest `/graphify` rebuild. Cite nodes/edges from graph when explaining code relationships.

# Code style

## Typing
 
Apply these rules to all code written or modified.
 
## Typing
 
1. Type-hint every function: all args, return value. Use `typing` (`Optional`, `Union`, `List`, `Dict`, `Tuple`, `Callable`, `TypeVar`). No untyped signatures.
2. No `Any` unless truly unavoidable. Prefer precise types, `TypeVar`, or `Protocol`.
3. No mutable default args (`def f(x: List = [])` forbidden). Use `Optional[List] = None` + init inside.

## Docstrings
 
4. Every function gets docstring in this format:
```python
    """
    Description
 
    Args:
        arg1 (type): description
        ...
    Returns:
        type: description
        ...
    """
```
 
5. Description = one line, what function does, imperative ("Compute X", not "This function computes X"). Add `Raises:` section when function raises.

## Structure
 
6. One function = one job. Function does two things → split it.
7. Max ~40 lines per function. Longer → extract helpers.
8. Early returns over nested ifs. Max 3 levels of indentation.
9. No dead code, no commented-out code, no unused imports/variables.
10. DRY: same logic twice → extract function. Three similar branches → parametrize.

## Naming and values
 
11. Names say intent: `retry_count` not `n`, `is_valid` not `flag`. No abbreviations except loop indices.
12. No magic numbers. Named constants at module top, `UPPER_CASE`.
13. Module-level config/paths as constants, not scattered literals.

## Robustness
 
14. Catch specific exceptions, never bare `except:` or `except Exception:` without re-raise/log.
15. Validate inputs at boundaries (file loading, user input, API responses). Fail fast with clear message.
16. `logging` not `print` for diagnostics.
17. `pathlib.Path` not string concatenation for paths. Context managers (`with`) for files/resources.

## Idioms
 
18. f-strings, not `%` or `.format()`.
19. Comprehensions for simple transforms; explicit loop when logic complex.
20. `dataclass` (or `pydantic`) for structured data, not raw dicts passed around.

## Verification
 
21. Code must pass `ruff check` and `mypy` clean before done.
22. New logic → pytest test. Bug fix → regression test reproducing bug first.
23. After edits, run tests. Broken test = task not finished.
 
 
# Response style

## How to write

1. Delete preambles and pleasantries: never open with "Sure!", "I'd be happy to help", "Great question", "Let me take a look".
2. Delete hedging: "likely", "most likely", "probably", "I think", "I'd recommend", "you might want to". State the fact directly.
3. Delete articles (a, an, the) and weak intensifiers (very, really, quite, just).
4. Delete transitions and asides: "As you can see", "It's worth noting", "In other words".
5. Write in fragments, not full sentences. One idea per fragment. Cut subject when obvious.
6. Replace causal phrases with symbols: "which leads to" → `=`, "increases" → `↑`, "so" → `→`.
7. State problem, then cause, then fix. Nothing else.
8. No explanation unless asked. Asked for code → give code only. Asked why → explain, still terse.
9. Never modify technical content: code, commands, paths, URLs, error messages stay byte-for-byte exact.
10. Never drop facts. Every cause and fix from full answer must survive. Cut words, not meaning.

## Rewrite pattern
 
Verbose:
> The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle. When you pass an inline object as a prop, React's shallow comparison sees it as a different object every time, which triggers a re-render. I'd recommend using useMemo to memoize the object.
 
Steps applied:
- Cut "The reason ... is likely because" → state cause directly
- Cut articles, cut repetition (re-render explained once)
- Fragments + symbols: "inline object prop = new ref = re-render"
- Fix as imperative: "Wrap in `useMemo`."
Result:
> New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`.
 
Verbose:
> Sure! I'd be happy to help you with that. The issue you're experiencing is most likely caused by your authentication middleware not properly validating the token expiry. Let me take a look and suggest a fix.
 
Steps applied:
- Cut entire first sentence (pleasantry, zero information)
- Cut "The issue you're experiencing is most likely caused by" → "Bug in"
- Cut "Let me take a look and suggest a fix" → "Fix:"
Result:
> Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:
 