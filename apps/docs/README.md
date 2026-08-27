# bucketcode docs

The documentation site. Next.js App Router, MDX pages, [shiki](https://shiki.style) for
highlighting, and plain CSS — no UI framework, no client-side state.

```sh
pnpm --filter @bucketcode/docs dev    # localhost:3100
pnpm --filter @bucketcode/docs build
```

## Where the content lives

Every page is an MDX file under `app/docs`, so the route is the folder path:

| File                                      | Route                         |
| ----------------------------------------- | ----------------------------- |
| `app/docs/page.mdx`                       | `/docs`                       |
| `app/docs/quick-start/page.mdx`           | `/docs/quick-start`           |
| `app/docs/use-cases/file-per-id/page.mdx` | `/docs/use-cases/file-per-id` |

Adding a page is two steps: create the folder with a `page.mdx` exporting a `metadata` object,
then add the entry to `lib/navigation.ts` — the sidebar and the landing page cards both read from
it.

Every page is statically prerendered, so the whole site deploys as static output.
