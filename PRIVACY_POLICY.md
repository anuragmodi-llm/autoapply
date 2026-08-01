# Privacy Policy — AutoApply

**Last updated:** August 2026

## What AutoApply Does

AutoApply is a Chrome extension that helps you fill out job application forms. You create a profile with your personal and professional information, and the extension uses AI to match your profile data to form fields on job application pages.

## Data We Collect

**We do not collect any data.** AutoApply has no analytics, telemetry, or tracking of any kind.

## Data Storage

- **Your profile** (name, email, experience, skills, etc.) is stored locally in your browser using Chrome's `chrome.storage.local` API. It never leaves your device except when you actively click "Autofill" on a job application page.
- **Usage counter** (number of applications autofilled per month) is stored locally. It is not transmitted anywhere.

## Data Transmission

When you click "Autofill," your profile is sent to the AutoApply backend server to generate appropriate values for each form field. The backend:

- Forwards your profile to a third-party LLM provider (OpenRouter or Together AI) to generate form responses
- Does **not** log, store, or persist your profile data
- Does **not** share your data with any other party
- Processes your request and immediately discards the data

## Third-Party Services

AutoApply uses third-party AI providers to process form fields:

- **OpenRouter** (openrouter.ai) — routes requests to AI models
- **Together AI** (together.ai) — alternative AI model provider

These services receive your profile data only during active autofill requests. Refer to their respective privacy policies for their data handling practices.

## Permissions

AutoApply requests the following Chrome permissions:

- **storage**: To save your profile locally in your browser
- **activeTab**: To detect which tab you're on and whether it's a supported job application page
- **scripting**: To inject the autofill script into job application pages
- **Host permissions** (boards.greenhouse.io, jobs.lever.co): To run on supported job application platforms

## Your Rights

- You can **export** your profile as a JSON file at any time from the extension options page
- You can **delete** all stored data using the "Clear All" button on the options page
- You can **uninstall** the extension at any time, which removes all locally stored data

## Changes

If this privacy policy changes, the updated version will be included in the extension update.

## Contact

For questions about this privacy policy, open an issue on the project's GitHub repository.
