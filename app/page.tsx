import Header from "@/components/home/Header";
import HeroSection from "@/components/home/HeroSection"
import FeaturesSection from "@/components/home/FeaturesSection"
import PricingSection from "@/components/home/PricingSection"
import CTASection from "@/components/home/CTASection"
import Footer from "@/components/home/Footer"
export default function Home() {
  return (
    <div>
      <Header />
      <HeroSection />
      <FeaturesSection />
      <PricingSection />
      <CTASection />
      <Footer />
    </div>
  );
}
