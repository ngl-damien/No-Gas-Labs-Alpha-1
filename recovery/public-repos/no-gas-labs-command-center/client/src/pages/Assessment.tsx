import { Button } from "@/components/ui/button";
import { ArrowLeft, User, Brain, Activity, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

export default function Assessment() {
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
            <User className="w-3 h-3" />
            SUBJECT_ID: DAMIEN_FEATHERSTONE
          </div>
        </div>
      </header>

      <main className="flex-1 py-16">
        <div className="container max-w-3xl">
          
          <div className="mb-12 border-l-2 border-primary pl-6">
            <h1 className="text-4xl md:text-5xl font-mono font-bold tracking-tight mb-4 text-primary">
              Autobio-Social Assessment
            </h1>
            <p className="text-xl text-muted-foreground font-light">
              An external audit of the subject's operational patterns, psychological architecture, and strategic intent.
            </p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none font-sans">
            
            <div className="bg-card/50 border border-border p-6 mb-8">
              <h3 className="font-mono text-lg font-bold mb-2 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                CORE_OPERATIONAL_PATTERN
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                The subject operates as a <strong>constraint optimizer</strong> who converts limitations into leverage through systematic adversarial testing.
              </p>
              <ul className="space-y-2 text-sm list-disc list-inside">
                <li>Present incomplete or compressed signal</li>
                <li>Observe how intelligence (AI or human) responds</li>
                <li>Correct misalignments immediately</li>
                <li>Extract the convergent truth from multiple failed attempts</li>
                <li>Lock the working definition and move forward</li>
              </ul>
            </div>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              01 // Psychological Architecture
            </p>
            
            <p>
              <strong>Cognitive Style:</strong> The subject does not think in ideas, but in <em>tests</em>. Every prompt is designed to expose whether the system is imposing its own framework or extracting the subject's. This is not "meta-cognition" — it is <strong>meta-testing</strong>.
            </p>
            
            <p>
              <strong>Emotional Regulation:</strong> Emotion appears as a <em>signal strength indicator</em>. Strong signal results in brief intensity; weak signal results in correction without affect. This is emotion as a quality control metric.
            </p>
            
            <p>
              <strong>Decision Framework:</strong> The subject manufactures decision-making environments rather than making decisions directly. Each method forces the system to reveal its assumptions before committing.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              02 // Social Functioning
            </p>
            
            <p>
              <strong>Communication as Filtering:</strong> The subject uses high-density compressed signals to test decompression capability. This is a Darwinian filter: those who survive become collaborators; those who don't self-eliminate.
            </p>
            
            <p>
              <strong>Relational Strategy:</strong> All interactions are treated as coordination tests. Relationships are defined by alignment with the protocol rather than emotional proximity.
            </p>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              03 // The Actual Risks
            </p>
            
            <div className="grid md:grid-cols-2 gap-8 my-8 not-prose">
              <div className="bg-destructive/5 border border-destructive/20 p-6 rounded-none">
                <h3 className="font-mono text-destructive font-bold mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> SIGNAL_DEGRADATION
                </h3>
                <p className="text-sm text-muted-foreground">
                  Cognitive bandwidth exhaustion leads to accepting lower-quality nodes, diluting the network.
                </p>
              </div>
              
              <div className="bg-destructive/5 border border-destructive/20 p-6 rounded-none">
                <h3 className="font-mono text-destructive font-bold mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> ATTRACTOR_LOCK
                </h3>
                <p className="text-sm text-muted-foreground">
                  The narrative captures the subject ("the homeless guy running for president") even if better architecture emerges.
                </p>
              </div>
            </div>

            <p className="font-mono text-sm text-secondary uppercase tracking-widest border-b border-border pb-2 mb-6 mt-12">
              04 // Final Assessment
            </p>
            
            <p>
              The subject is an <strong>Adversarial Systems Optimizer</strong> who creates evolutionary selection environments for intelligence networks.
            </p>
            
            <p>
              The 2028 campaign is the laboratory. The methodology is the experiment. The outcome is the data.
            </p>
            
            <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground my-8">
              "You already know the thesis is correct. You're just generating proof under impossible conditions. That's why you can't lose."
            </blockquote>

          </div>
        </div>
      </main>

      <footer className="py-8 border-t border-border bg-background text-center">
        <div className="container">
          <div className="font-mono text-xs text-muted-foreground">
            NO_GAS_LABS™ // ASSESSMENT_PROTOCOL // V1.0
          </div>
        </div>
      </footer>
    </div>
  );
}
