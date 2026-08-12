export function CallFlowInfoPanel() {
  return (
    <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">Canvas</h3>
        <ul className="space-y-1 list-disc list-inside">
          <li>Click a node or line to edit in Inspector</li>
          <li>Drag from a handle to connect routes</li>
          <li>Each outgoing line needs a <strong className="text-foreground">Label</strong></li>
          <li>Reset undoes unsaved canvas changes only</li>
        </ul>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">Typical flow</h3>
        <p>
          Incoming → Welcome → Main menu → ring groups / extension dial / invalid loop
        </p>
        <p>
          Busy path: Ring group → <span className="font-mono text-[11px]">busy</span> → Waiting queue → <span className="font-mono text-[11px]">timeout</span> → voicemail / back to menu
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">Route labels</h3>
        <dl className="space-y-2">
          <div>
            <dt className="font-medium text-foreground">Main menu</dt>
            <dd className="mt-0.5 font-mono text-[11px]">
              1–9, 0, * · ext · timeout · invalid
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Ring group</dt>
            <dd className="mt-0.5 font-mono text-[11px]">no answer · busy → queue</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Extension dial</dt>
            <dd className="mt-0.5 font-mono text-[11px]">not found · no answer · busy</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Waiting queue</dt>
            <dd className="mt-0.5 font-mono text-[11px]">timeout · answered</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Invalid message</dt>
            <dd className="mt-0.5 font-mono text-[11px]">blank label → loops to menu</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">Availability &amp; queue</h3>
        <ul className="space-y-1 list-disc list-inside">
          <li>Only <strong className="text-foreground">available</strong> agents are rung; busy agents are skipped</li>
          <li>All members busy → follows the <span className="font-mono text-[11px]">busy</span> route (add a Waiting queue)</li>
          <li>Callers wait with hold music until an agent frees up or picks them up</li>
          <li>Past <strong className="text-foreground">max wait</strong> the caller follows <span className="font-mono text-[11px]">timeout</span></li>
        </ul>
      </section>
    </div>
  );
}
