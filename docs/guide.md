# A plain-language guide to the coverage-survey sample size tool

This guide is for GiveWell grantmakers deciding how big a coverage survey should be. It assumes no statistics background. If you want the equations, read the [method notes](method.md) instead.

## In a nutshell

When you commission a coverage survey, you have to pick a sample size. A bigger sample costs more, but it also tells you more, and better information leads to better funding decisions. The right size is where those two forces cross: the last point at which one more batch of interviews still buys more decision-value than it costs.

This tool puts both sides in the same units, dollars, and finds that crossing point for you. You give it your starting beliefs about coverage, the cost-effectiveness assumptions behind the funding decision, and the cost per interview. It returns a recommended sample size, the value that survey is expected to create, and a chart showing exactly where bigger surveys stop being worth it.

The recommendation is a starting point for judgment, not a verdict. It is only as good as the assumptions you put in, and it deliberately leaves out some real-world complications (see [What the tool does not do](#what-the-tool-does-not-do)).

## The decision the tool is built around

The tool assumes your survey feeds one binary funding decision: **scale the program up** (commit a larger budget) or **scale it down** (commit a smaller one). Which choice is right depends on the program's true coverage, which you do not know yet. That is what the survey is for.

There is some coverage level at which the two choices break even. The tool calls this the **coverage tipping point** (written p* in the technical notes). Above it, scaling up is the better bet; below it, scaling down is. A survey is worth running only when there is a real chance the truth sits on either side of that line, and when learning which side is worth more than the survey costs.

If your survey is not tied to a decision like this, the tool is the wrong instrument. Its whole logic is "how much would this survey improve a real choice we are about to make."

## The core idea: information has a price and a value

Most sample-size rules answer a statistical question: how many interviews do we need to detect a difference, or to get a confidence interval narrower than some width? That is precision for its own sake. It does not ask whether the precision is worth paying for.

This tool answers a decision question instead: how many interviews do we need before the survey actually changes, or confirms, our funding call by enough to pay for itself? The benefit of an interview is measured in **value of information**: how much better our funding decision gets because we ran the survey rather than deciding blind.

Two facts drive the whole calculation:

1. **Information has diminishing returns.** The first interviews teach you the most. Once you roughly know where coverage sits, each additional interview sharpens the picture less. The value-of-information curve rises steeply, then flattens.

2. **Cost is roughly linear.** Each interview costs about the same as the last.

Put a rising-then-flattening benefit against a steady cost and there is a point where the next batch of interviews costs more than the information it adds. That point is the recommendation. Spending less leaves easy information on the table. Spending more buys precision you will not act on.

## A 60-second how-to

1. Open the [tool](../index.html). Optionally pick a **program template** to load rough starting numbers, then replace them with your own.
2. Enter your **prior**: your best guess at coverage today, plus a low-to-high range you are 95% sure contains the truth.
3. Fill in the **funding decision** block: the cost-effectiveness assumptions that set the coverage tipping point.
4. Enter the **cost per interview** and the **value-for-money hurdle** (the default is 8x, GiveWell's usual bar).
5. Read the recommendation at the top of the results. The green sentence tells you how many interviews to run and why.

The tool recomputes as you type. Everything runs in your browser, so your inputs never leave your machine.

## What each input means

### Your prior on coverage

This is what you would say today if someone asked you the program's coverage, before any new survey. The easiest way to enter it is a best guess plus a 95% range. If your best guess is 30% and you are 95% sure the truth is between 10% and 55%, the tool builds a bell-like curve to match.

The width of your range matters. A wide range means you are uncertain, which leaves more for a survey to teach you, which tends to justify a bigger sample. A narrow range means you already know coverage well, and a survey has less to add. If your beliefs are lopsided or have two humps (say, "either the program is working well or it collapsed, but probably not in between"), use the "draw the shape" option to set the probabilities by hand.

### The funding decision

These are your cost-effectiveness assumptions. The tool combines them to work out the coverage tipping point, so you do not enter the tipping point directly. The inputs are the standard pieces of a GiveWell cost-effectiveness estimate:

- **Eligible population (caseload)**: how many people the program would reach at full coverage.
- **Annual program budget**: the yearly cost, used as the cost-effectiveness denominator.
- **Mortality if untreated** and **mortality reduction**: how deadly the condition is without the program, and the share of those deaths the program averts.
- **Value per death averted**: in GiveWell's units of value (119 is the standard value for averting the death of a young child).
- **GiveDirectly value per dollar**: the cash benchmark the program is measured against (0.003355 is the standard anchor).
- **Budget if scaled up** and **budget if scaled down**: the two multi-year commitments at stake. The gap between them is how much rides on the decision.
- **Cost-effectiveness bar**: the multiple of cash transfers a program must clear, normally 8x.

When you have entered these, the tool shows three derived figures at the bottom of the block: the coverage tipping point, and the dollar value of one additional percentage point of coverage under each budget. You do not type these in; they fall out of the assumptions above. If the assumptions imply a tipping point below 0% or above 100%, the tool tells you, because that means the decision is already settled and no survey would change it.

### Survey cost and the hurdle

- **Cost per interview**: the all-in cost of one completed interview.
- **Fixed survey cost**: any one-off setup cost that does not scale with sample size. Leave it at zero if there is none.
- **Value-for-money hurdle**: how much decision-value each additional survey dollar must still return for the survey to keep growing. At 8x, the tool stops adding interviews once the next ones return less than $8 of better decisions per $1 spent. Lower the hurdle to justify a larger survey; raise it to be stricter.

The advanced settings (search range, number of simulations, random seed) rarely need changing. The seed makes a run reproducible: the same inputs always give the same answer.

## How to read the results

### The recommendation

The green sentence at the top is the headline. It states how many people to interview, what that survey is expected to be worth in better decisions, what it costs, and the trade-off in plain terms: up to the recommended size every extra dollar still clears your hurdle, and past it the next interviews cost more than they are worth.

If the box turns amber and says no size is worth it, the tool is telling you the survey does not pay for itself anywhere in the range. That is a real and useful answer. It usually means one of three things: the funding call is already clear enough that a survey would not change it, interviews are too expensive relative to what is at stake, or your hurdle is set too high. Try lowering the hurdle, lowering the cost per interview, or widening your prior.

### The four numbers

- **Recommended sample size**: how many interviews to run.
- **Value of the survey**: the expected improvement in decision-value, in dollars, at that size.
- **Survey cost**: what the recommended survey costs.
- **Value per dollar at the margin**: the return on the last batch of interviews. By construction this sits just above your hurdle.

### The three charts

- **Your starting beliefs**: the prior you entered. Taller bars are coverage levels you think more likely. This is what the survey will sharpen.
- **Value of the survey by sample size**: the rising-then-flattening benefit curve. The steep early part is why small surveys are often a bargain and why doubling a large survey rarely doubles its value.
- **Value returned by the next interviews**: the trade-off in one line. Each point is what the next batch of interviews returns per dollar. The recommended size is the last point above the dashed hurdle line. Everything to its right is overpaying.

## A worked example

Open the tool with its default numbers. They describe a generic treatment program: a best guess of 30% coverage, a 95% range of 10% to 55%, a $1.5 million annual budget, and a choice between a $20 million scale-up and a $4 million scale-down.

From those assumptions the tool derives a coverage tipping point of about 27%. Notice that your best guess, 30%, sits just above the tipping point, but your range runs well below it. In plain terms: you lean toward scaling up, but you are far from sure, and the wrong call is expensive. That is exactly the situation where a survey earns its keep, and the tool will recommend a substantial one.

Now change one thing at a time and watch the recommendation move:

- **Narrow your range** to 28% to 32%. You are now almost certain coverage is above the tipping point, the decision is nearly made, and the recommended survey shrinks or disappears.
- **Raise the cost per interview** from $200 to $1,000. Interviews are now five times as expensive, the margin clears your hurdle sooner, and the recommended sample falls.
- **Lower the hurdle** from 8x to 2x. You are willing to accept a thinner return on the last dollar, so the recommended survey grows.

Watching these levers move the answer is the fastest way to build intuition for what the tool is doing.

## What the tool does not do

It is a design-stage sizing aid, not a full cost-effectiveness model. To keep it usable in a browser it makes simplifying assumptions, and the answer is only as trustworthy as the inputs. In particular:

- It treats coverage as the only thing you are uncertain about. Everything else in the cost-effectiveness pipeline is held fixed.
- It assumes simple random sampling, not clustered or stratified designs. Real coverage surveys usually cluster, which means a given sample size carries less information than the tool assumes, so treat its recommendation as a floor.
- It handles one survey informing one binary decision. It does not model a baseline-plus-endline design or a continuous outcome.
- The program templates are illustrative scaffolding, not GiveWell-endorsed figures. Replace every field with your program's real numbers before relying on the result.

For the original, fuller treatment, including the SAM and MAM caseload split and multiple sources of uncertainty, use IDinsight's R script, described in the [mapping notes](idinsight_method_notes.md).

## Sharing a design

The tool writes every input into the page's web address. To share a specific design with a colleague, set it up and copy the address bar. They will open the tool with all your numbers already filled in. No login or file transfer is needed.

## Credit

The method follows IDinsight's Bayesian value-of-information analysis for GiveWell's Nigeria CMAM coverage survey, with Helen Keller Intl and the International Medical Corps as partners. This tool is a simpler, browser-native version of that work.
