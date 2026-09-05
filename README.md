# Welcome to your Lovable project

## Project info

**URL**: https://lead-flow-crm-by-accboost.lovable.app/app/raw-leads

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Quo AI Operations

Quo AI processing is event-driven, live, and budget-gated. Webhooks store Quo messages and enqueue small jobs; the Quo AI Assistant listens to Supabase Realtime for conversation/message/state changes so new chats appear without a full-screen refresh. Scheduled Edge Functions should mostly check database state and exit without AI calls when there is no real work.

Recommended Supabase Cron cadence:

- `ai-process-quo-jobs`: every 1-2 minutes. Processes pending `quo_ai_jobs` in small batches, locks jobs before work, retries failed jobs up to `max_attempts`, and respects AI budget mode.
- `ai-reminder-checker`: every 3-5 minutes. Checks due `quo_ai_tasks` and marks due work for review. This is database logic and should not normally call AI.
- `ai-sweep-conversations`: every 15-30 minutes. Uses SQL/rules first and only enqueues selected conversations needing attention.
- `ai-daily-brief`: every morning. Builds the management summary from existing state/tasks/cost logs.
- `quo-reconcile-sync`: safety-net backfill only. Reconciles missed Quo data incrementally and only enqueues jobs for new/changed conversations; it should not be the primary source of new messages in the UI.

Model routing is configured with environment variables, not hard-coded in UI:

- `AI_MODEL_FAST_CLASSIFIER`: cheap first-pass triage and simple acknowledgements.
- `AI_MODEL_MAIN_REASONER`: main persistent case-state reasoning.
- `AI_MODEL_RISK_VERIFIER`: only for risky or uncertain cases such as complaints, cancellation risk, payment disputes, uncertain scheduling, low confidence, or possible customer-loss decisions.
- `AI_MODEL_DAILY_BRIEF`: daily brief generation if AI summaries are enabled later.
- `AI_MODEL_EMBEDDINGS`: only for similarity/history features, not normal message processing.

Budget behavior:

- Below soft cap: normal routing.
- At soft cap or 80% of hard cap: skip low-priority old work.
- At 95% of hard cap: process only new/risky/high-value work.
- At hard cap: stop non-critical AI calls, keep storing messages, and create rule-based manager review tasks.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
