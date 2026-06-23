import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Install } from "@/components/Install";
import { Overview } from "@/components/Overview";
import { UsageMovie } from "@/components/UsageMovie";

// Landing page composition for the GitHub Pages site.
export function App() {
  return (
    <>
      <Header />
      <main id="top">
        <Hero />
        <Overview />
        <UsageMovie />
        <Install />
      </main>
      <Footer />
    </>
  );
}
