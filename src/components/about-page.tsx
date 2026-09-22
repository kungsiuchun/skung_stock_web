import { ArrowUpRight, Download } from "lucide-react";
import { AboutResumeTerminal } from "./about-resume-terminal";
import { PortfolioFooter } from "./portfolio-footer";
import { profile } from "@/config/profile";

export function AboutPage() {
  return (
    <>
      <div className="portfolio-wrap">
        <section className="about-intro">
          <div>
            <p className="eyebrow">03 / A LITTLE ABOUT ME</p>
            <h1>
              Data is my craft.
              <br />
              <em>Curiosity is the habit.</em>
            </h1>
            <p className="intro-body">
              I’m {profile.name} — Siu for short. {profile.summary}
            </p>
            <p className="intro-body" style={{ marginTop: 16 }}>
              My professional work is in data models, dashboards, and marketing
              analytics. Outside of that, I build stock research tools with AI
              agents and explore the world through photography.
            </p>
            <div className="hero-actions">
              <a
                className="portfolio-button"
                href={profile.resume}
                target="_blank"
                rel="noreferrer"
              >
                Read résumé PDF <ArrowUpRight size={17} />
              </a>
              <a className="text-link" href={profile.resume} download>
                Download résumé <Download size={16} />
              </a>
            </div>
          </div>
          <figure>
            <img
              src="/image/profile-siu-about.jpg"
              alt="Black and white portrait of Siu wearing glasses and a suit"
              width="960"
              height="1200"
            />
            <figcaption>
              SIUCHUN WILSON KUNG / DATA ANALYST & CREATIVE DEVELOPER
            </figcaption>
          </figure>
        </section>
        <section className="resume-section" aria-labelledby="experience-title">
          <div>
            <p className="eyebrow">THE PROFESSIONAL SIDE</p>
            <h2 id="experience-title">
              Experience, <em>at a glance.</em>
            </h2>
            {profile.experience.map((job) => (
              <article className="resume-experience" key={job.company}>
                <time>{job.dates}</time>
                <div>
                  <h3>{job.role}</h3>
                  <p className="company">{job.company}</p>
                  <p>{job.description}</p>
                </div>
              </article>
            ))}
            <div className="resume-details">
              <h3>Selected projects</h3>
              <ul>
                {profile.selectedProjects.map((project) => (
                  <li key={project.name}>
                    <strong>{project.name}:</strong> {project.description}
                  </li>
                ))}
              </ul>
            </div>
            <div className="resume-details">
              <h3>Education</h3>
              <p>
                {profile.education}
                <br />
                {profile.educationDates}
              </p>
            </div>
            <div className="resume-details">
              <h3>Certifications</h3>
              <ul>
                {profile.certificates.map((certificate) => (
                  <li key={certificate}>{certificate}</li>
                ))}
              </ul>
            </div>
          </div>
          <aside className="resume-sidebar">
            <AboutResumeTerminal />
            <div className="resume-details">
              <h3>Skills & tools</h3>
              <ul className="skill-list">
                {profile.skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
            <div className="resume-details">
              <h3>For the complete picture</h3>
              <p>
                This is a concise overview of my supplied résumé. Read the PDF
                for the full professional profile.
              </p>
              <a
                className="text-link"
                href={profile.linkedin}
                target="_blank"
                rel="noreferrer"
              >
                Connect on LinkedIn <ArrowUpRight size={16} />
              </a>
            </div>
          </aside>
        </section>
        <section className="camera-note">
          <img
            src="/image/nikon-d3500-product.png"
            alt="Nikon D3500 camera"
            width="700"
            height="595"
            loading="lazy"
          />
          <div>
            <p className="eyebrow">AND WHEN THE LAPTOP CLOSES</p>
            <h2>
              Learning to <em>look.</em>
            </h2>
            <p>
              My Nikon D3500 is a working instrument: a way to slow down, notice
              light, and pay attention to what belongs in the frame. The same
              curiosity runs through the tools I build and the photographs I
              take.
            </p>
            <a className="text-link" href="#/photography">
              Explore the photo journal <ArrowUpRight size={16} />
            </a>
          </div>
        </section>
      </div>
      <PortfolioFooter />
    </>
  );
}
