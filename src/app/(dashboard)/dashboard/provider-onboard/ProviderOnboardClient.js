"use client";

import { useState } from "react";
import { Button, Input, Card } from "@/shared/components";
import { Check } from "lucide-react";

const STEPS = [
  { id: 1, title: "Provider Details" },
  { id: 2, title: "Authentication" },
  { id: 3, title: "Review & Submit" },
];

export default function ProviderOnboardClient() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    name: "",
    apiBaseUrl: "",
    apiKey: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleNext = () => {
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log("Submitting provider data:", formData);
    setIsSubmitting(false);
    setIsSubmitted(true);
  };
  
  const handleReset = () => {
    setFormData({ name: "", apiBaseUrl: "", apiKey: "" });
    setCurrentStep(1);
    setIsSubmitted(false);
  };

  if (isSubmitted) {
    return (
      <div className="p-4 md:p-6 text-center">
        <Card className="max-w-md mx-auto p-8">
          <div className="flex justify-center items-center mb-4">
            <div className="bg-success/15 text-success rounded-full p-3">
              <Check size={32} />
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-2">Provider Submitted!</h1>
          <p className="text-text-muted mb-6">
            Your new provider configuration has been saved.
          </p>
          <Button onClick={handleReset}>Add Another Provider</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <Card className="max-w-2xl mx-auto">
        <div className="p-6 border-b border-border">
          <h1 className="text-2xl font-bold">Provider Onboarding Wizard</h1>
          <p className="text-text-muted">Add a new provider in a few easy steps.</p>
        </div>
        <div className="p-6">
          <div className="mb-6">
            <ol className="flex items-center w-full">
              {STEPS.map((step, index) => (
                <li
                  key={step.id}
                  className={`flex w-full items-center ${index < STEPS.length - 1 ? "after:content-[''] after:w-full after:h-1 after:border-b after:border-4 after:inline-block" : ""} ${currentStep > step.id ? "after:border-primary" : "after:border-border"}`}
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-full lg:h-12 lg:w-12 shrink-0" style={{ backgroundColor: currentStep >= step.id ? 'var(--primary)' : 'var(--surface-2)', color: currentStep >= step.id ? 'white' : 'var(--text-muted)'}}>
                    {step.id}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {currentStep === 1 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Step 1: Provider Details</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium mb-1">Provider Name</label>
                  <Input id="name" name="name" value={formData.name} onChange={handleChange} placeholder="e.g., My Custom AI" />
                </div>
                <div>
                  <label htmlFor="apiBaseUrl" className="block text-sm font-medium mb-1">API Base URL</label>
                  <Input id="apiBaseUrl" name="apiBaseUrl" value={formData.apiBaseUrl} onChange={handleChange} placeholder="https://api.custom.ai/v1" />
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Step 2: Authentication</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="apiKey" className="block text-sm font-medium mb-1">API Key</label>
                  <Input id="apiKey" name="apiKey" type="password" value={formData.apiKey} onChange={handleChange} placeholder="sk-..." />
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Step 3: Review & Submit</h3>
              <div className="space-y-2 rounded-lg border border-border p-4">
                <p><strong>Name:</strong> {formData.name}</p>
                <p><strong>API Base URL:</strong> {formData.apiBaseUrl}</p>
                <p><strong>API Key:</strong> ••••••••••••{formData.apiKey.slice(-4)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between p-6 border-t border-border">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 1}>
            Back
          </Button>
          {currentStep < STEPS.length ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Provider"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}