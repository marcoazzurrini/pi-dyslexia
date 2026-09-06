# Writing that reduces effort without losing meaning

Research for [issue #2](https://github.com/marcoazzurrini/pi-dyslexia/issues/2). Reviewed 2026-09-06.

**Status: research note with an approved trial implementation in version 0.2.0.** The active policy is the adapted root [`SKILL.md`](../../SKILL.md), not the initial replacement proposal below. The owner chose to retain Caveman's core Rules and Auto-Clarity sections, apply targeted fixes, and remove intensity levels. Benefits remain untested.

This phase concerns general message effectiveness, not a dyslexia-specific intervention. Fewer words is the primary product objective, subject to preserving requested coverage, meaning, and safety. Human-reader studies do not establish that an LLM instruction works; compare the adapted prompt against the model's normal output and the original ultra policy before claiming an improvement.

## Recommendation

Prefer concise, grammatical writing with explicit relationships between ideas. Remove repetition and irrelevant content before removing words that identify actors, conditions, causes, or uncertainty. Keep necessary technical terms and explain unfamiliar ones in context.

The evidence supports testing these choices, not prescribing one style for every reader. No reviewed study establishes a universal sentence-length limit, a ban on long words, or a benefit from systematically dropping articles and verbs.

### Scope and method

This is a targeted narrative review, not a systematic review or meta-analysis. Searches covered lexical simplification and dyslexia; sentence structure and legal comprehension; coherence and prior knowledge; information order; headings and lists; and jargon and processing fluency. Primary studies were selected for relevant manipulations and identifiable outcomes, including null results and limits to generalization. Search results and press coverage were used for discovery, not as substitutes for the papers.

Each entry identifies the material inspected. Several publisher PDFs were inaccessible; those entries rely only on the authors' abstracts in institutional repositories. Their methods, effect sizes, and risk of bias have not been fully assessed. This review is sufficient for a provisional policy, not a claim of scientific consensus or complete coverage through 2026.

Distinguish four kinds of claim:

- **Measured finding:** what participants did or reported under the study conditions.
- **Mixed or limited evidence:** null results, interacting factors, weak generalization, or incomplete source access.
- **Editorial advice:** a useful writing convention, not an experimental result.
- **Product preference:** a reversible choice for this personal tool, requiring evaluation here.

Reading time, comprehension, recall, perceived effort, and preference are different outcomes. Faster reading or greater confidence does not establish better understanding. Most studies below did not recruit dyslexic readers or test coding conversations.

## Primary evidence

### E1. Familiar words and word length in dyslexia

Rello, Baeza-Yates, Dempere-Marco, and Saggion (2013), *Frequent Words Improve Readability and Short Words Improve Understandability for People with Dyslexia*. [DOI](https://doi.org/10.1007/978-3-642-40498-6_15); [full text](https://www.superarladislexia.org/pdf/2013-Luz%20Rello-Frequency-Interact2013.pdf). Inspected full text, especially §§4–6, pp. 207–215.

**Measured:** Counterbalanced synonym substitutions in short Spanish texts, with 23 diagnosed dyslexic readers and 23 controls. Dyslexic participants were aged 13–37. More frequent words reduced reading time and fixation duration, but did not significantly improve comprehension. Shorter synonyms reduced reading time and improved comprehension scores in the dyslexic group. No significant effects were found in the control group.

**Limits:** Small sample, few short texts, narrow comprehension questions, and imperfect separation of frequency from length. The authors explicitly acknowledge that longer synonyms were also less frequent. A significant result in one group and a nonsignificant result in another does not by itself establish a difference between groups. Spanish results do not establish the same effects in English or other orthographies.

**Implication:** Prefer a familiar equivalent when it preserves the exact meaning. Do not replace a familiar technical term with a shorter but ambiguous word. This is not evidence for banning long words or deleting grammatical words.

### E2. Fewer words are not automatically easier

Rello, Baeza-Yates, and Saggion (2013), *The Impact of Lexical Simplification by Verbal Paraphrases for People with and without Dyslexia*. [DOI](https://doi.org/10.1007/978-3-642-37256-8_41); [full text](https://www.superarladislexia.org/pdf/2013-Luz%20Rello-cicling.pdf). Inspected full text, especially §§4–6.

**Measured:** A Spanish study with 23 diagnosed dyslexic participants and 23 controls compared verb–noun expressions with single verbs, such as the equivalent of “had trust” versus “trusted.” It found no significant improvement in reading time, fixation duration, or comprehension. Perceived simplicity did not match the performance results.

**Limits:** Two short news texts and a small sample cannot rule out smaller effects or benefits in harder texts. This is a closely related research program to E1, not independent replication of E1. The paper's post-hoc power discussion is not a basis for treating a null result as proof of no effect.

**Implication:** “Use a direct verb” is a reasonable editorial preference, not a guaranteed dyslexia intervention. Test understanding separately from preference.

### E3. Sentence structure matters beyond specialized concepts

Martínez, Mollica, and Gibson (2022), *Poor writing, not specialized concepts, drives processing difficulty in legal language*. [DOI](https://doi.org/10.1016/j.cognition.2022.105070); [published abstract](https://scholarship.law.tamu.edu/facscholar/2400/). Inspected the published abstract only.

**Measured:** A corpus analysis compared contracts with other English genres. Two experiments, total N = 184, found lower recall and comprehension for excerpts with difficult writing features than for versions without them. Center-embedded clauses particularly impaired recall. These clauses insert material inside another clause, separating words that readers must connect.

**Limits:** Legal excerpts are not interactive technical instructions. The abstract does not justify assigning an independent comprehension effect to every listed feature, such as passive voice or capitalization. An older author webpage describes a different sample; this note uses the published abstract rather than combining versions.

**Implication:** Keep the main actor and action easy to connect. Move long qualifications into adjacent sentences without changing their scope. Sentence length alone is not the intervention tested. Do not impose an absolute passive-voice ban.

### E4. Connectives can reduce the work of inference

van Silfhout, Evers-Vermeul, and Sanders (2015; online 2014), *Connectives as Processing Signals: How Students Benefit in Processing Narrative and Expository Texts*. [DOI](https://doi.org/10.1080/0163853X.2014.905237); [institutional abstract](https://research-portal.uu.nl/en/publications/connectives-as-processing-signals-how-students-benefit-in-process/). Inspected the abstract only.

**Measured:** An eye-tracking experiment with 141 Dutch eighth graders compared narrative and expository texts with and without connectives such as equivalents of “moreover,” “after,” and “because.” Connectives sped processing of subsequent information and reduced rereading time for previous information. They also prompted regressions to earlier text. Local comprehension, measured with bridging-inference questions, improved across reading-proficiency levels.

**Limits:** Dutch school texts; not an adult dyslexia trial. Local inference performance does not establish improved global comprehension. More regressions need not mean worse reading: a return to earlier text can support integration.

**Implication:** Keep “because,” “if,” “unless,” and “before” when they carry a necessary relationship. This recommendation extends the principle to coding instructions; not every listed connective was tested in this study. A slightly longer sentence can require less inference than disconnected fragments.

### E5. Coherence interacts with prior knowledge and task

McNamara, Kintsch, Songer, and Kintsch (1996), *Are Good Texts Always Better? Interactions of Text Coherence, Background Knowledge, and Levels of Understanding in Learning From Text*. [DOI](https://doi.org/10.1207/s1532690xci1401_1); [institutional abstract](https://asu.elsevierpure.com/en/publications/are-good-texts-always-better-interactions-of-text-coherence-backg/). Inspected the abstract only.

**Measured:** Two experiments varied coherence in science texts. Readers with little domain knowledge benefited from coherent text. More knowledgeable readers could benefit from minimally coherent text on deeper understanding measures. Results depended on whether assessment measured recall, text-based answers, inference, problem solving, or conceptual organization.

**Limits:** Learning from educational texts is not the same task as completing work with minimal effort. A harder text can provoke useful learning activity without being a better work aid. The knowledge interaction prevents a universal “more explicit is always better” claim.

**Implication:** Supply missing connections for unfamiliar topics. Do not manufacture difficulty to train the reader. Let expertise and the immediate task determine how much explanation is necessary.

### E6. Establish context before relying on it

Haviland and Clark (1974), *What's New? Acquiring New Information as a Process in Comprehension*. [DOI](https://doi.org/10.1016/S0022-5371(74)80003-4); [author-hosted full text](https://web.stanford.edu/~clark/1970s/Haviland,%20S.E.%20_%20Clark,%20H.H.%20_What's%20new_%20Acquiring%20new%20information%20as%20a%20process%20in%20comprehension_%201974.pdf). Inspected full text, pp. 512–521.

**Measured:** Three experiments with university students used sentence pairs and a button press when readers felt they understood the second sentence. A directly established antecedent made the target sentence faster to understand than one requiring an inferred connection. Experiments 2 and 3 addressed simple word repetition as an alternative explanation. Sample sizes were 16, 10, and 27.

**Limits:** Small laboratory studies with a subjective timing criterion, not objective task-success tests. They support making references and context available; they do not test “always put the answer first” or mandate one sentence order in every language.

**Implication:** Introduce an object or concept before referring to “it,” “this,” or “the result.” Repeating a noun can be useful orientation rather than waste. Answer-first organization remains a product convention, with prerequisites and safety taking priority.

### E7. Headings direct attention; lists help some structured tasks

Lorch and Lorch (1996), *Effects of Organizational Signals on Free Recall of Expository Text*. [DOI](https://doi.org/10.1037/0022-0663.88.1.38); [institutional abstract](https://scholars.uky.edu/en/publications/effects-of-organizational-signals-on-free-recall-of-expository-te/). Inspected the abstract only.

**Measured:** College students read texts with or without headings, overviews, and summaries. Signaling had no effect for a simple topic structure. For complex structures, it changed recall distribution and organization. Signaling only some topics could reduce recall of unsignaled content.

Morrow et al. (1998), *The Influence of List Format and Category Headers on Age Differences in Understanding Medication Instructions*. [DOI](https://doi.org/10.1080/036107398244238); [institutional abstract](https://experts.illinois.edu/en/publications/the-influence-of-list-format-and-category-headers-on-age-differen/). Inspected the abstract only.

**Measured:** Two experiments with younger and older adults compared medication instructions in lists and paragraphs. Lists improved understanding and recall and reduced some age-related differences. Headers were not uniformly helpful: some conditions impaired comprehension or recall.

**Limits:** The first study bundles several signaling devices; the second concerns medication schemas, not arbitrary bullet lists. Neither establishes that every sentence should become a bullet or that headings always help dyslexic readers.

**Implication:** Use numbered lists for ordered actions and bullets for genuinely separate items. Use headings when they help readers find sections. Keep conditions and warnings with the relevant action rather than in visually subordinate material. Avoid adding headings to an already clear two-sentence answer.

### E8. Jargon affects perceived effort, not just word count

Bullock, Colón Amill, Shulman, and Dixon (2019), *Jargon as a barrier to effective science communication: Evidence from metacognition*. [DOI](https://doi.org/10.1177/0963662519865687); [author-hosted full text](https://comm.osu.edu/sites/comm.osu.edu/files/PUS%202019-%20Bullock%20et%20al..pdf). Inspected full text, especially Methods, Results, and Discussion.

**Measured:** A US online experiment, N = 650, varied jargon and availability of mouse-over definitions in passages about three emerging technologies. Word count was held constant. Jargon reduced self-reported processing fluency. Providing definitions did not eliminate that effect.

**Limits:** No direct comprehension measure. Definitions required a separate interaction; this is not a test of a short inline explanation. The authors warn that their cross-sectional mediation measures cannot establish causal relationships among fluency, resistance, risk perception, and support. The sample was not representative. Their note also identifies reuse of the dataset in another paper; related publications should not automatically be counted as independent replications.

**Implication:** Avoid unnecessary jargon. When a term matters for the task, explain it where it appears rather than assuming a glossary resolves all difficulty. Keep exact API names, errors, and searchable terminology. Our goal is informed understanding, not greater persuasion or artificially lower risk perception.

### E9. Jargon effects depend on context

Shulman and Bullock (2020), *Don't dumb it down: The effects of jargon in COVID-19 crisis communication*. [DOI and open article](https://doi.org/10.1371/journal.pone.0239524). Inspected the abstract, methods, results, and limitations in the full article.

**Measured:** A US online experiment, N = 393, compared jargon and non-jargon messages across COVID-19, flood risk, and emergency-policy topics. Jargon reduced reported fluency in the latter two topics, but there was no significant effect in the COVID-19 condition.

**Limits:** The outcomes were perceived fluency and persuasion-related ratings, not tested comprehension. Topic, familiarity, and urgency were not cleanly separated. Participant compensation also changed during collection. A null result does not prove equivalence or that jargon is safe in every crisis.

**Implication:** Audience knowledge, motivation, and context matter. Neither “remove all technical terms” nor “warnings can use unexplained jargon” follows from these results.

## Editorial perspectives, not experimental evidence

**The Elements of Style.** The [1918 text by William Strunk Jr.](https://www.gutenberg.org/files/37134/37134-h/37134-h.htm), especially rules 10, 13, 15, and 16, recommends active voice, concision, parallel structure, and keeping related words together. Rule 13 explicitly says concision does not require every sentence to be short or all detail to be removed. This is the original Strunk edition, not the later Strunk and White revision.

Use those principles as editing prompts. Do not turn “omit needless words” into “omit grammatical words.” Do not remove negation from a prohibition to satisfy advice about positive phrasing. Passive voice remains useful when the actor is unknown or unimportant: “The file was deleted” must not become an invented claim about who deleted it.

**Google developer documentation style.** Its [abbreviation guidance](https://developers.google.com/style/abbreviations) recommends considering audience familiarity, introducing unfamiliar abbreviations, avoiding unnecessary one-use abbreviations, and keeping familiar terms such as API where expansion would not help. These are editorial conventions, not measured dyslexia effects. Expanding an acronym is not the same as explaining its meaning.

**Local preference.** Terse tone, answer-first structure, minimal ceremony, and optional detail fit this project's personal-use goal. Caveman ultra is one such preference. Systematic article removal, compressed fragments, and a fixed sentence-word target are not evidence-based requirements. The initial proposal below was superseded by a targeted adaptation of Caveman, rather than a wholesale replacement of its Rules section.

## Initial writing-policy proposal (superseded)

This historical candidate records the first synthesis. It is not injected at runtime; [`SKILL.md`](../../SKILL.md) is the single active writing policy:

> Write concise, natural sentences in the user's language. Remove irrelevant detail and repetition, not the words needed to understand the message.
>
> Start with the answer or next action when possible. Put prerequisites, conditions, and warnings before the action they govern. Give enough context to understand new concepts and references.
>
> Prefer familiar, precise words. Keep necessary technical terms and exact code, commands, paths, identifiers, errors, numbers, and units. Briefly explain unfamiliar terms on first use. Introduce an acronym only when useful; do not expand familiar acronyms mechanically or invent shortened words.
>
> Keep actors and actions easy to connect. Use pronouns only when the reference is clear. Keep words such as “because,” “if,” and “unless” when they express necessary relationships. Use consistent names for the same thing.
>
> Use numbered steps for ordered actions, bullets for separate items, and headings for useful navigation. Do not force every sentence into a list or impose a word limit that breaks meaning.
>
> Preserve negations, exceptions, uncertainty, evidence limits, and safety warnings. Separate observations from hypotheses. Keep required detail in the answer; offer optional explanation separately. Never claim a style setting changed unless it actually changed.

**Basis:** Familiar vocabulary and context draw on E1 and E4–E6; structure on E3; selective organization on E7; audience-sensitive terminology on E8–E9. Acronym conventions and active-voice preference are editorial. Answer-first ordering and optional detail are product choices. Exact-text preservation and warnings are safety requirements, not benefits that need a readability experiment to justify them.

## Before and after

These are constructed examples, not tested stimuli. Each improved version preserves the stated facts; the alternatives marked “too compressed” demonstrate what must not be lost.

### Familiar words without lost conditions

**Before:** “Prior to commencing the migration, verify that a restorable backup is available.”

**After:** “Before starting the migration, check that you have a backup you can restore.”

**Too compressed:** “Backup. Migrate.”

The prerequisite is a restorable backup, not merely a file called a backup.

### Structure and precision

**Before:** “The worker that the scheduler starts after the queue, which stores pending jobs, becomes nonempty processes one job at a time.”

**After:** “The queue stores pending jobs. After the queue becomes nonempty, the scheduler starts the worker. The worker processes one job at a time.”

The rewrite separates nested clauses without losing the trigger, actor, or concurrency limit.

### Technical terminology

**Before:** “This endpoint is idempotent, so repeating the same request has the same intended effect on server state as sending it once.”

**After:** “Repeating the same request to this endpoint has the same intended effect on server state as sending it once. This is called idempotency.”

**Too compressed:** “Safe to retry.”

Idempotency does not promise identical responses, no logging, or safety under every retry policy. Keep the term when readers need it for documentation or API behavior.

### Acronyms and reference

**Before:** “The time to live (TTL) controls how long the cache entry remains valid. After that interval, the cache entry expires.”

**After:** “The cache entry expires after its time to live (TTL).”

Use TTL if the explanation continues to use it or the setting is named TTL. Otherwise, “The cache entry expires after its configured lifetime” may be enough. Do not rename a literal configuration key.

### Uncertainty and exact errors

**Before:** “The log contains `ECONNREFUSED`. This may mean that the server is not running, although we have not yet checked the port.”

**After:** “The log shows `ECONNREFUSED`. The server may not be running. We have not checked the port yet.”

**Too compressed:** “Server down.”

The observation, hypothesis, and missing check remain distinct.

### Warnings and sequence

**Before:** “Running `git reset --hard` discards tracked changes in the index and working tree. Save any tracked changes you need before running it.”

**After:** “Warning: `git reset --hard` discards tracked changes in the index and working tree. Save any tracked changes you need first.”

**Too compressed:** “Reset cleans changes.”

Do not substitute a weaker word such as “cleans,” omit the affected scope, or hide the warning after an executable command block.

### Qualifications and quantities

**Before:** “In a small test, response time decreased by 12%, but the result may not generalize to production.”

**After:** “Response time fell by 12% in a small test. The result may not generalize to production.”

**Too compressed:** “12% faster.”

Response time is not interchangeable with throughput, and the production limitation is part of the finding.

## Evaluation plan

Evaluate this as a work aid, not reading training. Start with a small personal pilot; no new framework, telemetry, or eye tracker is needed. Prioritize lower word count while preserving essential understanding and safe task completion; measure effort and speed separately.

1. **Freeze materials before comparison.** Choose 12 representative coding situations: direct answers, debugging, unfamiliar concepts, conditional instructions, warnings, and evidence summaries. For each, write a checklist of required propositions, exact strings, quantities, uncertainty, and safe next actions. Use harmless examples or a disposable sandbox.
2. **Compare three conditions.** Prepare ordinary concise prose, the original upstream Caveman ultra policy, and the adapted root `SKILL.md` from the same fact sets. The original policy remains available at the immutable upstream revision linked in the README. Keep essential content equivalent. Record word count but do not force equality by removing facts. Include some roughly length-matched examples to help distinguish organization from sheer amount of text. Keep rendering constant; evaluate speech separately.
3. **Reduce order and familiarity effects.** Hide style labels and randomize presentation. Use different but comparable scenarios across conditions rather than showing the same answer three times immediately. Rotate assignments in later sessions. Record topic familiarity and language. Treat unavoidable carryover as a limitation.
4. **Check understanding and task success first.** Ask the reader to explain the main point, identify the applicable condition and warning, and choose the next action. Score against the predefined checklist rather than the answer's wording. Allow access to the answer during work; this is not a memory examination. Record wrong actions and omissions separately from minor paraphrase differences.
5. **Measure effort separately.** Record time to a correct decision, clarification requests, rereading, and a 1–7 effort rating. Record comfort and preferred style separately. Do not force a speed target. Record timeouts and incorrect decisions rather than dropping them from the timing results.
6. **Use explicit acceptance gates.** Reject a candidate that changes protected text or loses a necessary condition, warning, or uncertainty. For the personal pilot, require no observed loss of essential understanding or safe task completion relative to ordinary prose, together with lower word count and no consistent increase in effort or clarification burden across sessions. This is a conservative product gate, not a statistical proof of non-inferiority. If results are mixed, retain the current preference and revise the problematic rule before retesting.
7. **Report the limits.** Keep per-scenario results and report failures, not only averages. An N-of-1 pilot can guide this installation, not claims about dyslexic readers generally. Broader claims require a separately planned study with adequate sample size, dyslexic and non-dyslexic participants, language and expertise information, counterbalancing, and uncertainty estimates. Do not pool different languages as if their reading demands were identical.

A minimal record is: scenario, condition, language/familiarity, required facts preserved, correct next action, safety errors, time, clarification count, effort, and preference. Save no private conversation content without consent.

Readability formulas and word counts can flag text for review. They do not test whether a reader understands a condition, interprets an identifier correctly, or takes a safe action. Automated checks can protect literal strings and flag omissions for review; human assessment remains necessary for meaning and comprehension.

## Follow-up and implementation boundary

- [Issue #1](https://github.com/marcoazzurrini/pi-dyslexia/issues/1) already tracks response length, comprehension, and comfort. Reuse that evaluation work with the adapted policy as the third condition; no duplicate evaluation issue is needed.
- Keep [issue #2](https://github.com/marcoazzurrini/pi-dyslexia/issues/2) open for broader evidence and prompt-effectiveness evaluation. The research does not establish universal benefits or which rules improve a model's default behavior.
- **Approved implementation, version 0.2.0:** replace the unmodified upstream bundle with the adapted root `SKILL.md`; retain the core STE-inspired rules, explicit negation safeguards, and Auto-Clarity; fix ambiguity and uncertainty conflicts; add coverage, context, terminology, and selective structure guidance. Remove `vendor/`, retain the upstream MIT notice in root `LICENSE`, and keep `/dyslexia caveman on|off|status` with automatic activation on session load. No extra style selector, automatic rewriting, or stored-message changes.
- Regression checks cover root-policy loading, preserved safeguards, on/off behavior, session resets, invalid files, and package contents. A loader smoke check verifies integration; the owner's fresh-session trial is still required to evaluate actual answers.
- Typography, terminal layout, speech, and fading text remain in [#3](https://github.com/marcoazzurrini/pi-dyslexia/issues/3), [#4](https://github.com/marcoazzurrini/pi-dyslexia/issues/4), and [#5](https://github.com/marcoazzurrini/pi-dyslexia/issues/5).
