import React, { useEffect, useState } from "react";
import { updateLevels, nextLevel } from "../api";
import type { LevelDraft, StateSnapshot } from "../types";

const defaultLevelDraft: LevelDraft = {
    index: 0,
    durationSeconds: 20 * 60,
    smallBlind: 0,
    bigBlind: 0,
    ante: 0,
    isBreak: false,
    label: "New Level"
};

export default function LevelsScreen({ state }: { state: StateSnapshot }) {
    const [levels, setLevels] = useState<LevelDraft[]>([]);
    const [isDirty, setIsDirty] = useState(false);

    const currentLevelIndex = state.tournament?.currentLevelIndex ?? -1;

    // Load levels from state when component mounts or state updates (if not dirty)
    useEffect(() => {
        if (!isDirty && state.levels.length > 0) {
            setLevels(state.levels.map(l => ({
                index: l.index,
                durationSeconds: l.durationSeconds,
                smallBlind: l.smallBlind,
                bigBlind: l.bigBlind,
                ante: l.ante,
                isBreak: l.isBreak,
                label: l.label
            })).sort((a, b) => a.index - b.index));
        }
    }, [state.levels, isDirty]);

    const handleUpdate = (index: number, updates: Partial<LevelDraft>) => {
        setLevels(prev => {
            const next = prev.map((l, i) => i === index ? { ...l, ...updates } : l);
            return next;
        });
        setIsDirty(true);
    };

    const handleAddLevel = () => {
        setLevels(prev => {
            const nextIndex = prev.length;
            return [...prev, { ...defaultLevelDraft, index: nextIndex, label: `Level ${nextIndex + 1}` }];
        });
        setIsDirty(true);
    };

    const handleRemoveLevel = (index: number) => {
        setLevels(prev => {
            const filtered = prev.filter((_, i) => i !== index);
            // Re-index
            return filtered.map((l, i) => ({ ...l, index: i }));
        });
        setIsDirty(true);
    };

    const saveChanges = async () => {
        await updateLevels(levels);
        setIsDirty(false);
    };

    return (
        <div className="card">
            <div className="card-header">
                <h3>Manage Levels</h3>
                <div className="button-row">
                    <button
                        className="btn"
                        onClick={() => nextLevel()}
                        disabled={!state.tournament || state.tournament.status !== "running"}
                        title="Skip to next level immediately"
                    >
                        Skip Level
                    </button>
                    <button className="btn" onClick={handleAddLevel}>Add Level</button>
                    {isDirty && (
                        <button className="btn primary" onClick={saveChanges}>Save Changes</button>
                    )}
                </div>
            </div>

            <div className="levels-header">
                <div>Label</div>
                <div>Mins</div>
                <div>SB</div>
                <div>BB</div>
                <div>Ante</div>
                <div>Break</div>
                <div></div>
            </div>

            <div className="levels" style={{ maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}>
                {levels.map((level, idx) => {
                    const isPassed = idx < currentLevelIndex;
                    const isCurrent = idx === currentLevelIndex;

                    return (
                        <div
                            key={`${idx}`}
                            className={`level-row ${isCurrent ? 'active-level' : ''}`}
                            style={isCurrent ? { borderLeft: "4px solid var(--primary)", background: "var(--surface-active)" } : {}}
                        >
                            <input
                                className="level-label"
                                value={level.label}
                                onChange={(e) => handleUpdate(idx, { label: e.target.value })}
                                disabled={isPassed}
                            />
                            <input
                                type="number"
                                value={level.durationSeconds / 60}
                                onChange={(e) => handleUpdate(idx, { durationSeconds: Number(e.target.value) * 60 })}
                                disabled={isPassed}
                            />
                            {!level.isBreak ? (
                                <>
                                    <input
                                        type="number"
                                        value={level.smallBlind}
                                        onChange={(e) => handleUpdate(idx, { smallBlind: Number(e.target.value) })}
                                        disabled={isPassed}
                                    />
                                    <input
                                        type="number"
                                        value={level.bigBlind}
                                        onChange={(e) => handleUpdate(idx, { bigBlind: Number(e.target.value) })}
                                        disabled={isPassed}
                                    />
                                    <input
                                        type="number"
                                        value={level.ante}
                                        onChange={(e) => handleUpdate(idx, { ante: Number(e.target.value) })}
                                        disabled={isPassed}
                                    />
                                </>
                            ) : (
                                <>
                                    <div className="pill muted" style={{ justifyContent: "center" }}>-</div>
                                    <div className="pill muted" style={{ justifyContent: "center" }}>-</div>
                                    <div className="pill muted" style={{ justifyContent: "center" }}>-</div>
                                </>
                            )}
                            <label className="toggle small">
                                <input
                                    type="checkbox"
                                    checked={level.isBreak}
                                    onChange={(e) => handleUpdate(idx, { isBreak: e.target.checked })}
                                    disabled={isPassed}
                                />
                            </label>
                            <button
                                className="btn small"
                                style={{ color: "#ef4444", border: "none", background: "transparent", fontSize: "18px", opacity: isPassed ? 0.3 : 1 }}
                                onClick={() => !isPassed && handleRemoveLevel(idx)}
                                title={isPassed ? "Cannot remove passed level" : "Remove level"}
                                disabled={isPassed}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
