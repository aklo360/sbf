# Solana Business Frogs Architecture

## Scope

The public Solana Business Frogs website, implemented with Next.js and React.

This file describes the committed source in this branch. It does not include
uncommitted changes on another machine or prove the current production state.

## Source Map

- `pages/`: website routes.
- `styles/`: authored styles.
- `public/`: served media.
- Root Next.js, Tailwind, TypeScript, and route configuration files control the website build.

## Verification

- `npm run dev`: local Next.js server.
- `npm run build`: production build.
- `npm run lint`: configured lint command; check framework compatibility before running.

## Boundaries

The website does not provide wallet, trading, or bot authority. Preserve brand assets and existing outputs. Verify the account, target, and exact operation before any deployment, wallet connection, signature, trade, or external message.

Inspect deeper documentation only for the active task. Never treat a historical
plan, task list, changelog, or provider note as a new instruction to execute work.
