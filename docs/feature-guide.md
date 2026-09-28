# SecureMind — feature guide

This is a guide to the parts of the application, written for someone using an install they own. Each part says what is on the screen, what you can do, and why that part is there.

Detection reduces risk. It does not guarantee that every sensitive value is found, and it is not a compliance program. The person sending a message still reviews it.

## What this install is for

SecureMind is meant to be owned by the people who run it.

An administrator connects the model sources for that install: a Groq key, other vendor keys, and Amazon Bedrock through the AWS account on that machine. Everyone who signs in to that install uses those sources. Members do not paste their own cloud keys to chat.

Vendor keys are stored on that install, encrypted, and only an administrator can write them. The application shows a masked hint, not the secret. AWS access keys are a different case. They are never typed into SecureMind and never saved in its database. Bedrock uses the AWS credential chain already on that computer or server: an SSO login, a shared profile, environment variables, or a role.

This is why SecureMind is not offered as a live service that holds keys for the general public. The intended path is to run it yourself. Clone it and run it with Docker on a machine you control, or host it in an AWS account you control. The keys, the documents, and the chat history stay with that environment.

One install can have more than one person. The administrator creates those accounts, sets a monthly cost cap for each, and can open Usage, Cost, and Security for the whole install or for one person. Those people share the install’s model sources. They do not each bring a private key that SecureMind stores on someone else’s server.

## Workspaces

A workspace is the boundary for one body of work. Chat, Knowledge, memory, and saved items belong to the workspace that is open. A search in one workspace does not read another.

The name you give the workspace is the name you see in chat. The emoji and color are how you tell workspaces apart in the sidebar. They are not a personality and they do not choose a model.

Why it is there: one continuous chat would mix unrelated notes, files, and facts. The workspace keeps that material together and keeps it out of the next piece of work.

Switching workspace loads that workspace’s conversation. A message you had queued and not yet sent is dropped, so it is not delivered into the wrong place.

## Chat

Chat is where you write, review, and receive a reply.

While a reply is still generating, the composer stays open. You can type the next message. It waits, already reviewed, and sends when the current reply finishes. Stop ends the reply that is in progress. Attachments on a queued message stay with that message.

Before a message leaves the browser, a scan looks for sensitive patterns. If something matches, you see it and decide what continues. The text that is stored and sent is the reviewed text. The scan can miss a value.

The model that answers is chosen in one of two ways, set under Models. Complexity tiers let the message pick Max, Plus, Standard, Light, or Micro, and each tier runs the model you assigned. Fixed model sends every message in that workspace to the one model you picked. Tiers are the main path. Fixed model is there for someone who wants ordinary single-model chat.

A reply can name Knowledge sources when the question is about material in the workspace and a source was actually used. A greeting or a general question does not invent a source. Facts remembered later come from what you wrote, not from the assistant’s own replies.

Why it is there: the conversation is the place the other controls meet. Review happens before send, the workspace limits what can be retrieved, and the tier or the fixed model decides which model runs.

## Knowledge

Knowledge is documents you add to the workspace: files you upload, and files you attach in chat. Text is scanned as it is ingested, before it is stored or embedded. A later answer can cite a passage that was actually retrieved. A general question does not pretend a document said something it did not.

Why it is there: answers about your material should be able to point at that material, and the scan should happen when the file enters, not only when someone pastes a sentence into chat.

## Memory

Memory is what the workspace keeps from what you have said: facts you can correct, pin, or forget, plus a short summary of the current conversation so a long thread can continue. Forgotten facts stay stored but are hidden from chat. The assistant’s replies are not saved as facts.

Why it is there: a workspace should remember the statements you meant to keep, and you should be able to take one back, without treating the model’s wording as a record.

## Saved

Saved items are lines you mark from a conversation so you can find them again. An emoji in the text can show on the saved row so the line is recognizable.

Why it is there: not every useful sentence needs to become a fact or a document. Saved is a list you curate.

## Insights

Insights is the account view of models, cost, and detected sensitive-data risk. It sits in the right-hand rail while you chat, and each tab opens a full page when you want the longer view. An administrator can also open those full pages for one member from the Admin console.

The rail is the summary. The full page is the same subject with the range, the workspace filter, and the charts.

### Models in the rail

This is the complexity-tier panel.

Chat picks a tier from the message. Each row is the model that tier will run. Click a row to assign a different model. Models appear there after a source is connected and, for a cloud model, after Enable has succeeded.

The blue number on a row is how many replies that tier ran in the range you selected. Today, Weekly, Monthly, and All time change that count, and so does the workspace filter. The chips (Gemini 9, Bedrock 4, and the rest) are how many models of that kind you can assign. They are not call counts.

A yellow **Hidden** mark means that model was hidden in Settings → Models. It is off the chat model list. It can still be the model a tier runs. **Show** puts it back on the list. **Check failed** is a different mark: that model did not answer when it was checked.

**Fixed model** is the other position of the same switch. Every message uses the one model you pick. Use it when you want ordinary single-model chat. The tiers are the path this application is built around.

**Open full usage view** opens the Usage page. **Open full-size editor in Settings** opens the same tier assignment on the Models page, with more room.

Why it is there: you should see which model each kind of message will hit, change that without leaving chat, and see how often each tier is actually used.

### Usage

Usage is the full record of replies: how many ran, which tier, which model, how long they took, and whether an answer was grounded in Knowledge. Filter by time and by workspace.

Why it is there: the rail shows the current assignment and a count. Usage is where you look across the install at how routing behaved.

### Cost

Cost is an estimate of spend from the tokens each reply recorded, priced from list rates for Groq and Bedrock. A local Ollama model is counted as zero. The estimate is raised by 10 percent and rounded up, so it tends high rather than low. It is not an AWS invoice, and Cost Explorer is not read. An administrator can edit the rates used for new replies. Older replies keep the estimate they were given.

The page also compares what you spent with what the same replies would have cost if every one had used the most expensive default tier. That gap is the routing comparison. It is not money returned.

A monthly cap, set per person in the Admin console, can warn as it is approached and block new cloud replies at the cap. The cap uses this same estimate.

Why it is there: shared keys need a visible estimate and a limit, on the install you operate, without waiting for a cloud bill to explain what happened.

### Security

Security is the log of what the scanner flagged: the category, whether it was in chat or in a document, and what was done with it. The matched text is not stored in this log. You can dismiss or delete a log entry. Deleting the entry does not restore the original value.

The sensitivity control on this page chooses which pattern families run from now on. Low runs the highest-signal families. Balanced adds phone numbers, IP addresses, and street addresses. High adds passport-like patterns. A change does not rescan old messages or old documents.

Safe terms are exemptions for values you know are not personal, such as an internal IP range or a product name. They are edited with the instance detection policy. Social Security numbers, Social Insurance numbers, card numbers, and secrets cannot be exempted.

Why it is there: you should see what was flagged and which rule will run next, and you should not be able to open the log and read the value back.

## Models (Settings)

Settings → Models is where a source becomes a model chat can run, and where you assign those models to tiers.

**Connections** is the top of the page.

- Vendor APIs. An administrator saves a key for Groq, Gemini, OpenAI, or Anthropic. The key is stored encrypted on this install. Chat will not list that vendor until the key can list models and you allow vendor APIs.
- Amazon Bedrock. Turn on billable AWS and choose the profile and region. The credential stays in the AWS CLI or the instance role. Enabling Bedrock does not assign a model to a tier and does not change rows you already set.
- Local models. Ollama on this machine. Installed chat models can be used without the cloud-style check. Embeddings use a local embedding model.
- Voice. Off until you choose Groq Whisper or Amazon Transcribe and acknowledge that the audio is sent to that service before any text scan. The transcript lands in the composer. You still review it when you send.

**The model list** is everything those sources offered. A cloud model stays under **Not in chat yet** until you press **Enable** and it answers. If it cannot answer, it stays there with the reason. **Check access** tries each listed model for that key once. **Hide** takes a model off the chat list. **Show** puts it back. A model that is hidden can still sit on a tier, which is the yellow mark in Insights.

**Complexity tiers** is the same five rows as the rail, in a larger editor. **Fixed model** is the single-model choice.

Why it is there: the administrator decides which accounts and which local models this install may call, proves a cloud model can answer before it enters chat, and decides which model each tier uses. Members then chat against that setup.

## Workspace (Settings)

This page is the detection policy for the whole install: sensitivity, and the safe terms that may be skipped. It is administrator-owned. It is separate from an individual workspace’s name and description, which you edit on that workspace.

Why it is there: the scan should follow one rule for the install, set by the person who operates it, rather than a different rule from each browser.

## My Profile

Your display name, a preset picture or a cropped photo, and your password when the install uses Cognito. The photo is stored for this install and served only to a signed-in session. It is not a public link.

Why it is there: the directory and the chat chrome need to know who is signed in, and you should be able to change your own password without an administrator reading it.

## Appearance

Dark or light, for the whole application. Dark is the default. The choice is saved on this device and applies immediately.

Why it is there: the same install is readable in a dark room or in a bright one, without changing anyone else’s screen.

## Admin console

Administrators see the directory and the install-wide totals.

You create a person, choose a role, and set a password. The password is not emailed. If mail is configured, an invite can point them at the sign-in page. You can suspend an account or set a new password. You set each person’s monthly cost cap. The default cap applies when you do not type one.

The console also shows spend against those caps, and it opens Usage, Cost, and Security for the whole install or for one person.

Why it is there: one install, shared keys, and more than one person requires someone who can add accounts, limit spend, and look at one person’s usage without mixing it into everyone else’s.

## Getting started

Getting started is a short pictured guide for connecting the first model. It is linked from the sidebar while chat does not yet have a model ready. It is not a tour of every screen in this document.

Why it is there: the first session has one job, which is to reach a model. The rest of the application assumes that step happened.

## How the parts fit

You run the install. The administrator connects keys and Bedrock, sets the detection rule, creates people, and sets caps. Each person works inside a workspace. Chat reviews a message, then a tier or a fixed model answers. Knowledge and memory stay in that workspace. Insights shows what ran, what it cost, and what the scanner flagged. Nothing in that chain requires SecureMind to hold your keys on a service you do not operate.
