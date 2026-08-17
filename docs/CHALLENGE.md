# Personal Finance Manager — Frontend Technical Challenge

## Purpose

The goal of this challenge is to see how you design, build, and structure a non-trivial web application front end: a personal finance manager that handles bank accounts and their associated transactions (a ledger system), with real-time balances, expense reporting, future bill management, and budget projection.

**Our main focus is on how you identify and solve problems, make trade-offs, and think critically — not on full completion of the project.** A smaller, well-reasoned, well-built slice is far more valuable to us than a broad but shallow implementation. We would rather see three screens you're proud of than seven you rushed.

---

## Format

- **1 week** from receipt to deliver the code. We expect roughly **8–12 hours of actual effort** — please don't sink your whole week into it. If you run out of time, note what you'd do next in your README.
- **45 minutes** of presentation and discussion, where you'll walk us through your work and we'll dig into your decisions together.

---

## Scope: This Is a Frontend Challenge

**The backend will not be evaluated.** You are free to:

- Mock the API entirely (MSW, `json-server`, a static JSON fixture, an in-memory store, `localStorage` / IndexedDB — your call)
- Generate the backend with AI and not review it closely
- Stand up a real backend if you prefer — but understand that we won't be looking at it

We won't assess database schema, server-side architecture, query performance, or API implementation quality. What we *do* care about is the **shape of the data contract you design for yourself** — how you model accounts, transactions, categories, and projections, and how the client consumes that model. Be ready to talk about that in the discussion.

> **This repository already contains a working backend** — an in-memory Node/Express
> API with 18 months of seeded data. Use it, extend it, or replace it. See the
> [README](../README.md) and [API reference](./API.md). Its data contract is a
> starting point, not a verdict; disagreeing with it out loud is welcome.

Similarly, authentication and authorization are **not required**. Skip them.

---

## User Stories

1. As a user, I want to manage my personal accounts, including multiple bank accounts and their associated transactions.
2. As a user, I want to see the balance for each account in real time, or as of any point in time I choose.
3. As a user, I want to see a report of my expenses classified by category for each month.
4. As a user, I want to store future bills and income, and see a projection of my total budget balance.
5. As a user, I want to track expenses tied to particular projects — e.g. a house remodel, a trip to France.

You do not need to implement all five. Pick what best demonstrates your thinking and say why in your README.

---

## Tech Stack

- **Frontend:** React (preferred). TypeScript strongly preferred.
- **Everything else:** your choice — state management, routing, data fetching, build tooling, testing.

---

## Design System

We'd like to see you work from a design system rather than ad-hoc styling. Either approach is fine:

- **Adopt an existing one** — UntitledUI, MUI, Chakra, Radix + shadcn/ui, Ant Design, Mantine, etc.
- **Build a small one yourself** — design tokens (color, spacing, typography, radii), a handful of composable primitives, and consistent usage across the app.

What we're looking for is **consistency and reuse**: a coherent visual language, components that compose rather than duplicate, and styling decisions that scale past the screens you built. Be prepared to explain why you chose the system you did and where it fought you.

We are not evaluating visual design talent. A clean, consistent, accessible interface beats a beautiful bespoke one.

---

## What We're Looking For

### Frontend architecture

- Component structure and composition; where you draw boundaries
- State management: what's server state vs. client state, and how you handle each
- Data fetching, caching, and invalidation strategy
- How the app would accommodate a new feature or a change in requirements

### Handling real-world data

- Financial data is unforgiving — how do you handle currency, precision, and date/timezone edge cases?
- Large transaction lists: pagination, virtualization, filtering, sorting
- Derived/computed values (running balances, projections) — where does that computation live, and why?

### Quality and craft

- Loading, empty, error, and partial-failure states
- Form handling and client-side validation
- Accessibility: keyboard navigation, semantics, focus management
- Responsive behaviour
- Clean, readable, well-documented code
- Testing — we're more interested in *what* you chose to test and why than in coverage numbers

### Communication

- A README that explains your decisions, your trade-offs, and what you'd do with more time
- How clearly you walk us through your work in the discussion

---

## Optional / Discussion Only

These are **not scored**, but we may discuss them:

- Containerization or deployment instructions
- How you'd scale the application for a large number of users
- How you'd approach the backend if it were in scope

---

## AI Usage

We actively encourage using AI. We also expect you to own what it produces.

- Come prepared to explain **how and where** you used it.
- Be ready to explain and defend any code in the repo, AI-generated or not. "The model wrote that" is not an answer we can evaluate.
- Since the backend isn't being assessed, AI-generating it wholesale is completely fine — just tell us that's what you did.
- If you leaned on AI heavily in a specific area, flag it. We'd rather have an honest map of the work than guess.

---

## Deliverables

1. **Code** — a shared git repository (preferred) or a zip file by email
2. **Instructions** to install dependencies and run the project locally, including whatever mock backend or fixtures you used
3. **A README** covering:
   - What you built and what you deliberately left out
   - Key architectural decisions and the trade-offs behind them
   - Your design system choice and rationale
   - Where you used AI
   - What you'd tackle next with more time
