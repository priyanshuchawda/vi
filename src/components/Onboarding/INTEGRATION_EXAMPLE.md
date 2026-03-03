/\*\*

- Example: Integrating Onboarding into App.tsx
-
- This shows how to add the onboarding wizard to your application.
- Uncomment and modify the code below to integrate into your actual App.tsx

- EXAMPLE 1: Full App Replace
- ***

import { useState, useEffect } from 'react'; import { OnboardingWizard } from
'./components/Onboarding';

function App() { const [showOnboarding, setShowOnboarding] = useState(false);
const [currentUser, setCurrentUser] = useState<{ userId: string; analysis?: any;
} | null>(null);

// Check if user has completed onboarding useEffect(() => { const userId =
localStorage.getItem('perseus_user_id'); if (!userId) { setShowOnboarding(true);
} else { setCurrentUser({ userId }); // Optionally load their analysis
loadUserAnalysis(userId); } }, []);

const loadUserAnalysis = async (userId: string) => { try { const result = await
window.electronAPI.getUserAnalysis(userId); if (result.success &&
result.data?.data) { setCurrentUser(prev => prev ? { ...prev, analysis:
result.data!.data } : null); } } catch (error) { console.error('Failed to load
user analysis:', error); } };

const handleOnboardingComplete = (userId: string, analysis?: any) => { // Save
user ID to localStorage localStorage.setItem('perseus_user_id', userId);

    // Update state
    setCurrentUser({ userId, analysis });
    setShowOnboarding(false);

    // Additional onboarding completion logic
    console.log('Onboarding completed for user:', userId);
    if (analysis) {
      console.log('Channel analysis available:', analysis);
    }

};

// Show onboarding wizard if needed if (showOnboarding) { return
<OnboardingWizard onComplete={handleOnboardingComplete} />; }

// Your existing App UI return ( <div> <h1>Welcome to Perseus Video Editor</h1>

<p>User ID: {currentUser?.userId}</p>

      {currentUser?.analysis && (
        <div>
          <h2>Your Channel Insights</h2>
          <p>{currentUser.analysis.analysis.channel_summary}</p>
        </div>
      )}
    </div>

); }

export default App;

\*/

/\*\*

- EXAMPLE 2: Show Onboarding as a Modal
- ***

/\* import { useState, useEffect } from 'react'; import { OnboardingWizard }
from './components/Onboarding';

function App() { const [showOnboarding, setShowOnboarding] = useState(false);
const [currentUser, setCurrentUser] = useState<{ userId: string; analysis?: any;
} | null>(null);

// Check if user has completed onboarding useEffect(() => { const userId =
localStorage.getItem('perseus_user_id'); if (!userId) { setShowOnboarding(true);
} else { setCurrentUser({ userId }); // Optionally load their analysis
loadUserAnalysis(userId); } }, []);

const loadUserAnalysis = async (userId: string) => { try { const result = await
window.electronAPI.getUserAnalysis(userId); if (result.success &&
result.data?.data) { setCurrentUser(prev => prev ? { ...prev, analysis:
result.data!.data } : null); } } catch (error) { console.error('Failed to load
user analysis:', error); } };

const handleOnboardingComplete = (userId: string, analysis?: any) => { // Save
user ID to localStorage localStorage.setItem('perseus_user_id', userId);

    // Update state
    setCurrentUser({ userId, analysis });
    setShowOnboarding(false);

    // Additional onboarding completion logic
    console.log('Onboarding completed for user:', userId);
    if (analysis) {
      console.log('Channel analysis available:', analysis);
    }

};

// Show onboarding wizard if needed if (showOnboarding) { return
<OnboardingWizard onComplete={handleOnboardingComplete} />; }

// Your existing App UI return ( <div> <h1>Welcome to Perseus Video Editor</h1>

<p>User ID: {currentUser?.userId}</p>

      {currentUser?.analysis && (
        <div>
          <h2>Your Channel Insights</h2>
          <p>{currentUser.analysis.analysis.channel_summary}</p>
        </div>
      )}

      {/* Rest of your editor UI */}
    </div>

); }

export default App; \*/

/\*\*

- Alternative: Show Onboarding as a Modal \*/

/\* import { useState } from 'react'; import { OnboardingWizard } from
'./components/Onboarding';

function App() { const [showOnboardingModal, setShowOnboardingModal] =
useState(false);

const handleOnboardingComplete = (userId: string, analysis?: any) => {
localStorage.setItem('perseus_user_id', userId); setShowOnboardingModal(false);
// Continue with your app };

return ( <> <div> {/_ Your main app _/} <button onClick={() =>
setShowOnboardingModal(true)}> Complete Onboarding </button> </div>

      {showOnboardingModal && (
        <div className="fixed inset-0 z-50">
          <OnboardingWizard onComplete={handleOnboardingComplete} />
        </div>
      )}
    </>

); } \*/

/\*\*

- Alternative: Manually Trigger Analysis Later \*/

/\* const triggerChannelAnalysis = async (youtubeUrl: string) => { try { const
userId = localStorage.getItem('perseus_user_id')!;

    const result = await window.electronAPI.completeOnboarding({
      userId,
      name: 'User Name',
      email: 'user@example.com',
      youtubeChannelUrl: youtubeUrl,
    });

    if (result.success && result.data?.analysisId) {
      // Poll for completion
      const analysis = await window.electronAPI.pollAnalysisUntilComplete(
        result.data.analysisId
      );

      if (analysis.success) {
        console.log('Analysis complete:', analysis.data);
      }
    }

} catch (error) { console.error('Analysis failed:', error); } }; \*/
