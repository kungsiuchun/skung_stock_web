import { useState } from "react";
import { ArrowUpRight, Copy, Download } from "lucide-react";
import { profile } from "@/config/profile";
import { PortfolioFooter } from "./portfolio-footer";

export function ContactPage() {
  const [copyStatus, setCopyStatus] = useState("");
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(profile.email);
      setCopyStatus("Email copied.");
    } catch {
      setCopyStatus(
        "Copy unavailable. Select the email address above to copy it.",
      );
    }
  };
  return (
    <>
      <section className="contact-page portfolio-wrap">
        <div>
          <p className="eyebrow">04 / START A CONVERSATION</p>
          <h1>
            Have something
            <br />
            <em>in mind?</em>
          </h1>
          <p className="contact-intro">
            A role in data, a tool worth building, or a conversation about
            photography. I’d love to hear what you’re working on.
          </p>
        </div>
        <div>
          <div className="contact-actions">
            <a className="contact-action" href={`mailto:${profile.email}`}>
              <div>
                <p>01 / EMAIL</p>
                <span>{profile.email}</span>
              </div>
              <ArrowUpRight size={22} />
            </a>
            <a
              className="contact-action"
              href={profile.linkedin}
              target="_blank"
              rel="noreferrer"
            >
              <div>
                <p>02 / LINKEDIN</p>
                <span>Siu Chun Kung</span>
              </div>
              <ArrowUpRight size={22} />
            </a>
            <a className="contact-action" href={profile.resume} download>
              <div>
                <p>03 / RÉSUMÉ</p>
                <span>The professional profile · PDF</span>
              </div>
              <Download size={21} />
            </a>
          </div>
          <div className="contact-copy">
            <button type="button" onClick={copyEmail}>
              <Copy size={13} />
              Copy email address
            </button>
            <span role="status">{copyStatus}</span>
          </div>
        </div>
      </section>
      <PortfolioFooter />
    </>
  );
}
