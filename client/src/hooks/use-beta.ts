import { useMutation } from "@tanstack/react-query";
import { api, type CalculateBetaRequest, type CalculateBetaResponse } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useCalculateBeta() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CalculateBetaRequest) => {
      // Validate input before sending using the schema from routes/schema
      const validatedInput = api.beta.calculate.input.parse(data);

      const res = await fetch(api.beta.calculate.path, {
        method: api.beta.calculate.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validatedInput),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const errorData = await res.json();
          // Try to parse as our validation error structure
          try {
            const validatedError = api.beta.calculate.responses[400].parse(errorData);
            throw new Error(validatedError.message || "Validation failed");
          } catch {
            throw new Error(errorData.message || "Invalid request");
          }
        }
        if (res.status === 500) {
            throw new Error("Server error occurred while calculating beta");
        }
        throw new Error("Failed to calculate beta");
      }

      const rawResponse = await res.json();
      return api.beta.calculate.responses[200].parse(rawResponse);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Calculation Failed",
        description: error.message,
      });
    },
  });
}
