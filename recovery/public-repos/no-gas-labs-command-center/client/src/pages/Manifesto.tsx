import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, FileText, Lock } from "lucide-react";
import { Link } from "wouter";

export default function Manifesto() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      
      {/* Header */}
      <header className="border-b border-border bg-card/30 sticky top-0 z-50 backdrop-blur-md">
        <div className="container py-4 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" className="font-mono text-muted-foreground hover:text-primary gap-2">
              <ArrowLeft className="w-4 h-4" /> RETURN_TO_COMMAND
            </Button>
          </Link>
          <div className="font-mono text-sm text-secondary flex items-center gap-2">
            <Lock className="w-3 h-3" />
            ARTIFACT_ID: ADVERSARIAL_HARDENING
          </div>
        </div>
      </header>

      <main className="flex-1 py-16">
        <div className="container max-w-3xl">
          
          <div className="mb-12 border-l-2 border-primary pl-6">
            <h1 className="text-4xl md:text-5xl font-mono font-bold tracking-tight mb-4 text-primary">
              Leveraging High‑Density Language Under Adversarial Conditions
            </h1>
            <p className="text-xl text-muted-foreground font-light">
              A Field Manual for Open Systems, Public Experiments, and Narrative Stress‑Testing
            </p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none font-sans">
            <p className="lead text-2xl font-light text-foreground/90">
              High‑attention moments are not power. They are stress tests.
            </p>
            
            <p>
              When attention spikes, language is placed under load. Words that were previously inert become contested. Metaphors acquire unintended force. Observers project motives, hierarchies, and endgames that were never specified. This is not a failure mode; it is the environment.
            </p>
            
            <p>
              The question is not how to control interpretation, but how to design language that survives contact with adversarial reading.
            </p>
            
            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              01 // Density Is Not Volume
            </p>
            
            <p>
              High verbal density does not mean verbosity. It means compression without collapse.
            </p>
            
            <p>
              A dense text carries multiple readings without breaking under them. It allows skeptics, supporters, critics, and neutral observers to extract meaning without requiring agreement. It does not ask the reader to suspend disbelief; it asks them to observe process.
            </p>
            
            <p>
              Low‑density language relies on tone, charisma, or implied authority. Under scrutiny, it fails. High‑density language relies on structure, falsifiability, and internal consistency. Under scrutiny, it clarifies.
            </p>
            
            <p>
              If this system works, it works because it is legible — not because it is loud.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              02 // Adversarial Hardening Begins with Explicit Limits
            </p>
            
            <p>
              Any public project that does not define its boundaries will have them defined externally.
            </p>
            
            <div className="grid md:grid-cols-2 gap-8 my-8 not-prose">
              <div className="bg-primary/5 border border-primary/20 p-6 rounded-none">
                <h3 className="font-mono text-primary font-bold mb-4 flex items-center gap-2">
                  <span className="text-green-500">✓</span> THIS IS WHAT THIS IS
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex gap-2"><span className="text-primary">•</span> An open, documented experiment in coordinating human intention with distributed technical systems.</li>
                  <li className="flex gap-2"><span className="text-primary">•</span> A public ledger of decisions, not a promise of outcomes.</li>
                  <li className="flex gap-2"><span className="text-primary">•</span> A test of infrastructure, not a claim of destiny.</li>
                </ul>
              </div>
              
              <div className="bg-destructive/5 border border-destructive/20 p-6 rounded-none">
                <h3 className="font-mono text-destructive font-bold mb-4 flex items-center gap-2">
                  <span className="text-red-500">✕</span> THIS IS WHAT THIS IS NOT
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex gap-2"><span className="text-destructive">•</span> Not a movement that requires belief.</li>
                  <li className="flex gap-2"><span className="text-destructive">•</span> Not a claim of authority over others.</li>
                  <li className="flex gap-2"><span className="text-destructive">•</span> Not a replacement for institutions, expertise, or law.</li>
                  <li className="flex gap-2"><span className="text-destructive">•</span> Not a prophecy, prediction, or inevitability narrative.</li>
                </ul>
              </div>
            </div>
            
            <p>
              Stating limits is not weakness. It is load‑bearing honesty.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              03 // Ontological “Seeding” Without Ontological Capture
            </p>
            
            <p>
              Ideas spread when they are useful to the reader, not when they demand allegiance. When language is designed to be portable, it must avoid exclusive jargon that signals in‑group dominance, absolutist framing, and moral coercion disguised as inspiration.
            </p>
            
            <p>
              Instead, it should offer components, not conclusions: a frame someone can reuse without citing the source, a question that survives disagreement, a method that can be tested independently.
            </p>
            
            <p>
              If an idea requires credit to persist, it will not persist.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              04 // The Role of Narrative in Technical Proof
            </p>
            
            <p>
              Narrative is not decoration. It is indexing. Humans do not remember systems; they remember stories about systems. The risk is when narrative becomes substitution rather than interface.
            </p>
            
            <p>
              To remain adversarially hardened, narrative must point to artifacts, not replace them. Claims must be traceable to observable work. Symbolism must remain optional, never mandatory. The story exists to help others locate the work — not to explain it away.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              05 // Distributed Intelligence Is a Method, Not a Mystique
            </p>
            
            <p>
              “Distributed intelligence” does not mean sentience, autonomy, or consciousness in the romantic sense. It means multiple systems contributing partial competence, no single point of epistemic authority, and feedback loops that update based on evidence, not belief.
            </p>
            
            <p>
              The moment distributed intelligence is framed as magic, it becomes fragile. The moment it is framed as coordination under constraint, it becomes boring — and therefore durable. Boring systems survive. Mythologized systems attract attack.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              06 // Intention Without Grandiosity
            </p>
            
            <p>
              Intention is not manifestation. Intention is selection pressure. It determines what is worked on, what is ignored, and what tradeoffs are accepted.
            </p>
            
            <p>
              Intention does not bend reality; it filters action. When intention is treated as a causal force independent of execution, systems fail. When it is treated as a prior, systems converge. This project treats intention as input, not outcome.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              07 // Public Documentation as Defense
            </p>
            
            <p>
              Opacity invites speculation. Documentation limits it. By logging decisions, reversals, and uncertainties in public, errors become evidence of learning, not failure. Observers can audit claims without trust. The system resists myth inflation.
            </p>
            
            <p>
              This is not transparency for virtue signaling. It is transparency as risk mitigation. If something cannot be documented without embarrassment, it should not be done.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              08 // Campaign Language Without Campaign Claims
            </p>
            
            <p>
              Language associated with campaigns tends to overpromise and under‑specify. This system avoids that by refusing to predict outcomes.
            </p>
            
            <p>
              There is no claim that this will scale, succeed, or convert others. There is only a claim that the work will be visible, the process will be legible, and the experiment will continue until falsified or exhausted. Anything more would be dishonest.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              09 // Handling Misinterpretation Without Escalation
            </p>
            
            <p>
              Misinterpretation is inevitable. The response to it determines trajectory. Adversarial hardening requires no reactive clarification spirals, no defensive posture against bad‑faith readings, and no attempts to “win” narrative disputes.
            </p>
            
            <p>
              Instead: Let artifacts speak. Let time collapse weak interpretations. Respond only when silence would mislead materially. Attention decays. Records remain.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              10 // Why High‑Density Language Matters Now
            </p>
            
            <p>
              In low‑attention environments, simplicity wins. In high‑attention environments, precision survives. When many eyes are watching, ambiguity becomes liability, hyperbole becomes attack surface, and emotional escalation becomes signal loss.
            </p>
            
            <p>
              High‑density language constrains projection. It gives fewer handles to pull. It does not eliminate hostility, but it reduces leverage.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              11 // The Ethical Constraint
            </p>
            
            <p>
              Any system that influences perception carries ethical load. This project rejects psychological manipulation, false urgency, manufactured consensus, and exploitation of belief or vulnerability.
            </p>
            
            <p>
              Not because these are ineffective — but because they corrupt feedback. A system that cannot tell whether it is succeeding honestly is already failing.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              12 // What Success Looks Like (And What It Doesn’t)
            </p>
            
            <p>
              Success is not virality. Success is not adoption. Success is not agreement.
            </p>
            
            <p>
              Success is a working artifact, a documented process, a clear failure mode if it collapses, and reusability by others without permission. If nothing remains after attention fades except documentation, that is acceptable.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              13 // The Standing Invitation
            </p>
            
            <p>
              No one is asked to join anything. The only invitation is to observe, replicate, critique, or ignore. All are valid responses. Systems that require participation to justify themselves are already unstable.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              14 // Closing Constraint
            </p>
            
            <p>
              If you are reading this looking for a belief system, a leader to follow, or a promise of outcome — you will not find one.
            </p>
            
            <p>
              If you are reading this looking for a method under observation, a system exposed to scrutiny, and an experiment that can fail publicly — then you are already aligned, without needing to agree with anything else.
            </p>

            <div className="mt-16 p-8 border border-dashed border-border bg-card/50">
              <h4 className="font-mono font-bold text-primary mb-4">FINAL_NOTE</h4>
              <p className="text-sm text-muted-foreground">
                This text is intentionally dense, bounded, and non‑evangelical. It is designed to absorb attention without amplifying distortion, and to remain intelligible months later when context has cooled.
              </p>
            </div>

          </div>
        </div>
      </main>

      <footer className="py-8 border-t border-border bg-background text-center">
        <div className="container">
          <div className="font-mono text-xs text-muted-foreground">
            NO_GAS_LABS™ // ADVERSARIAL_HARDENING_PROTOCOL // V1.0
          </div>
        </div>
      </footer>
    </div>
  );
}
